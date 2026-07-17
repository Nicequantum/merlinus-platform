import { get, put } from '@vercel/blob';
import { bufferToVisionDataUrl } from './visionImagePrep';
import { logger } from './logger';
import { networkRetryDelayMs, sleep } from './networkErrors';
import { buildImageProxyUrl, isAllowedImagePathname } from './imageUrls';

const BLOB_PUT_MAX_ATTEMPTS = 3;
/** Cold isolate + large private blob must not eat the entire Grok extract budget. */
const BLOB_GET_TIMEOUT_MS = 20_000;
const VISION_PREP_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
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

function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  }
  return token;
}

export interface UploadedBlobImage {
  pathname: string;
  url: string;
}

export async function uploadImageToBlob(
  buffer: Buffer,
  filename: string,
  contentType: string
): Promise<UploadedBlobImage> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `benz-tech/${Date.now()}-${safeName}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < BLOB_PUT_MAX_ATTEMPTS; attempt++) {
    try {
      const blob = await put(key, buffer, {
        access: 'private',
        contentType,
        token: getBlobToken(),
        addRandomSuffix: false,
      });

      return {
        pathname: blob.pathname,
        url: buildImageProxyUrl(blob.pathname),
      };
    } catch (error) {
      lastError = error;
      if (attempt === BLOB_PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Blob upload failed');
}

export async function fetchPrivateBlobAsDataUrl(pathname: string): Promise<string> {
  if (!isAllowedImagePathname(pathname)) {
    throw new Error('Invalid image pathname');
  }

  const result = await get(pathname, { access: 'private', token: getBlobToken() });
  if (!result) {
    throw new Error('Image not found in blob storage');
  }
  const bytes = await new Response(result.stream).arrayBuffer();
  const base64 = Buffer.from(bytes).toString('base64');
  const contentType = result.blob.contentType || 'image/png';
  return `data:${contentType};base64,${base64}`;
}

/** Vision-optimized fetch — downscales and JPEG-encodes before Grok base64 upload. */
export async function fetchPrivateBlobAsVisionDataUrl(pathname: string): Promise<string> {
  if (!isAllowedImagePathname(pathname)) {
    throw new Error('Invalid image pathname');
  }

  const started = Date.now();
  const result = await withTimeout(
    get(pathname, { access: 'private', token: getBlobToken() }),
    BLOB_GET_TIMEOUT_MS,
    'blob.get vision'
  );
  if (!result) {
    throw new Error('Image not found in blob storage');
  }
  const getMs = Date.now() - started;
  const bytes = Buffer.from(
    await withTimeout(
      new Response(result.stream).arrayBuffer(),
      BLOB_GET_TIMEOUT_MS,
      'blob.stream vision'
    )
  );
  const streamMs = Date.now() - started;
  const contentType = result.blob.contentType || 'image/jpeg';
  const dataUrl = await withTimeout(
    bufferToVisionDataUrl(bytes, contentType),
    VISION_PREP_TIMEOUT_MS,
    'vision.prep sharp'
  );
  logger.info('blob.vision_fetch_ok', {
    pathname,
    bytes: bytes.length,
    getMs,
    streamMs,
    totalMs: Date.now() - started,
  });
  return dataUrl;
}

export async function streamPrivateBlob(pathname: string) {
  if (!isAllowedImagePathname(pathname)) {
    return null;
  }

  const result = await get(pathname, { access: 'private', token: getBlobToken() });
  return result;
}