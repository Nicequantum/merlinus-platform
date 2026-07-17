import { api, ApiError } from '@/lib/api';
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
const UPLOAD_PER_FILE_ATTEMPTS = 3;

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
  if (error instanceof ApiError) return isRetriableHttpStatus(error.status);
  return isNetworkFailure(error);
}

export async function uploadFileAsAttachment(
  file: File,
  idPrefix: string,
  compress: (file: File) => Promise<File> = compressImageForUpload
): Promise<ImageAttachment> {
  let lastError: unknown;

  for (let attempt = 0; attempt < UPLOAD_PER_FILE_ATTEMPTS; attempt++) {
    try {
      const compressed = await compress(file);
      const { pathname, url, name } = await api.uploadImage(compressed);
      return {
        id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        pathname,
        url,
        name: name || file.name,
      };
    } catch (error) {
      lastError = error;
      if (!isRetriableUploadError(error) || attempt === UPLOAD_PER_FILE_ATTEMPTS - 1) {
        throw error;
      }
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError;
}

export async function uploadFilesAsAttachments(files: File[], idPrefix: string): Promise<ImageAttachment[]> {
  return mapWithConcurrency(files, UPLOAD_CONCURRENCY, (file) =>
    uploadFileAsAttachment(file, idPrefix)
  );
}

/** Higher concurrency + vision-tuned compression for RO document scans. */
export async function uploadRoScanAttachments(files: File[]): Promise<ImageAttachment[]> {
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