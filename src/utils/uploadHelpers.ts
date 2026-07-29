import { api, ApiError } from '@/lib/api';
import { ensureUploadPathReady, withUploadSlot } from '@/lib/bayUploadReady';
import { clientLog } from '@/lib/clientLog';
import {
  isNetworkFailure,
  isRetriableHttpStatus,
  networkRetryDelayMs,
  sleep,
} from '@/lib/networkErrors';
import type { ImageAttachment } from '@/types';
import { compressImageForRoScan, compressImageForUpload } from '@/utils/imageCompression';

const UPLOAD_CONCURRENCY = 3;
const RO_SCAN_UPLOAD_CONCURRENCY = 6;
/** More attempts on cold bay Wi‑Fi / cold Worker first put. */
const UPLOAD_PER_FILE_ATTEMPTS = 4;
/** Hard ceiling so a single photo never spins "Saving…" forever. */
const UPLOAD_HARD_TIMEOUT_MS = 75_000;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

function isRetriableUploadError(error: unknown): boolean {
  if (error instanceof ApiError) {
    // Include bare 500 — Workers cold-start / first R2 put often surfaces as 500 HTML or JSON.
    // 401 after idle: silent session refresh may have failed once — retry once more.
    return (
      error.status === 401 ||
      isRetriableHttpStatus(error.status, { includeServerError: true })
    );
  }
  return isNetworkFailure(error);
}

function withHardTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — check bay Wi‑Fi and retry.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export type UploadAttachmentOptions = {
  /** Called before each network attempt (0-based). Use for bay status text. */
  onAttempt?: (attempt: number, maxAttempts: number) => void;
  /** Warm session/R2/audit path before the first put (default true). */
  warmBeforeUpload?: boolean;
  /** Bypass shared upload slot (default false — always share the bay pool). */
  skipUploadSlot?: boolean;
};

async function uploadFileAsAttachmentInner(
  file: File,
  idPrefix: string,
  compress: (file: File) => Promise<File>,
  options?: UploadAttachmentOptions
): Promise<ImageAttachment> {
  let lastError: unknown;
  const warmBefore = options?.warmBeforeUpload !== false;

  if (warmBefore && typeof window !== 'undefined') {
    // Block briefly for a real warm — first capture after login must not race cold R2.
    try {
      const detail = await ensureUploadPathReady({ maxWaitMs: 8_000 });
      if (!detail.ok || !detail.r2) {
        clientLog.warn('upload.warm_incomplete', detail);
      }
    } catch {
      // ignore warmup failure — upload still attempts with retries
    }
  }

  for (let attempt = 0; attempt < UPLOAD_PER_FILE_ATTEMPTS; attempt++) {
    try {
      options?.onAttempt?.(attempt, UPLOAD_PER_FILE_ATTEMPTS);
      // Re-compress each attempt so FormData body is always fresh (never retry drained body).
      const compressed = await compress(file);
      if (!compressed || compressed.size === 0) {
        throw new Error('Photo was empty after capture — take the picture again.');
      }
      const { pathname, url, name } = await api.uploadImage(compressed);
      if (!pathname) {
        throw new Error('Upload succeeded but storage path was missing — retry the photo.');
      }
      return {
        id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pathname,
        url,
        name: name || file.name,
      };
    } catch (error) {
      lastError = error;
      clientLog.warn('upload.attempt_failed', {
        attempt,
        name: file.name,
        size: file.size,
        status: error instanceof ApiError ? error.status : undefined,
        message: error instanceof Error ? error.message : String(error),
      });
      if (!isRetriableUploadError(error) || attempt === UPLOAD_PER_FILE_ATTEMPTS - 1) {
        throw error;
      }
      // Re-warm between retries — cold R2 often succeeds on second put.
      if (typeof window !== 'undefined') {
        void ensureUploadPathReady({ force: true, maxWaitMs: 5_000 }).catch(() => undefined);
      }
      await sleep(networkRetryDelayMs(attempt) + (attempt === 0 ? 600 : 0));
    }
  }

  throw lastError;
}

export async function uploadFileAsAttachment(
  file: File,
  idPrefix: string,
  compress: (file: File) => Promise<File> = compressImageForUpload,
  options?: UploadAttachmentOptions
): Promise<ImageAttachment> {
  const run = () =>
    withHardTimeout(
      uploadFileAsAttachmentInner(file, idPrefix, compress, options),
      UPLOAD_HARD_TIMEOUT_MS,
      'Photo upload'
    );

  if (options?.skipUploadSlot) {
    return run();
  }
  // Shared slot pool — prevents first-login thrash of parallel cold R2 puts.
  return withUploadSlot(run);
}

export async function uploadFilesAsAttachments(files: File[], idPrefix: string): Promise<ImageAttachment[]> {
  return mapWithConcurrency(files, UPLOAD_CONCURRENCY, (file) =>
    uploadFileAsAttachment(file, idPrefix)
  );
}

/** Higher concurrency + vision-tuned compression for RO document scans. */
export async function uploadRoScanAttachments(files: File[]): Promise<ImageAttachment[]> {
  // Outer map concurrency is higher, but each file still takes a shared upload slot (cap 2).
  return mapWithConcurrency(files, RO_SCAN_UPLOAD_CONCURRENCY, (file) =>
    uploadFileAsAttachment(file, 'roimg', compressImageForRoScan)
  );
}

/** Client re-fetch of a saved image for OCR — never hang indefinitely on cold proxy. */
export const FETCH_ATTACHMENT_TIMEOUT_MS = 20_000;

/** Fetch a persisted blob as a File for on-device OCR when the original capture File is gone. */
export async function fetchImageAttachmentAsFile(attachment: ImageAttachment): Promise<File> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_ATTACHMENT_TIMEOUT_MS);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Could not load saved image "${attachment.name}"`);
    }
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    return new File([blob], attachment.name || 'diagnostic.jpg', { type });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(
        `Timed out loading saved image "${attachment.name}" — check connection and retry.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a pending scan/diagnostic image to a File for OCR — uses cache or blob URL. */
export async function resolvePendingImageFile(img: {
  file?: File;
  attachment?: ImageAttachment;
}): Promise<File> {
  if (img.file) return img.file;
  if (img.attachment) return fetchImageAttachmentAsFile(img.attachment);
  throw new Error('Image file is missing — delete and recapture the photo.');
}
