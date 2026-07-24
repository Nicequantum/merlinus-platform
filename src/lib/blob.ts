import 'server-only';

/**
 * Diagnostic / RO image storage — Cloudflare R2 via objectStorage abstraction.
 * Pathnames remain benz-tech/... for DB compatibility; served via /api/images proxy.
 */

import { bufferToVisionDataUrl } from './visionImagePrep';
import { logger } from './logger';
import { getObject, getObjectBuffer, putObject, type StoredObjectStream } from '@/lib/storage/objectStorage';
import { buildImageProxyUrl, isAllowedImagePathname } from './imageUrls';

const VISION_PREP_TIMEOUT_MS = 15_000;
const BLOB_GET_TIMEOUT_MS = 20_000;

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

export interface UploadedBlobImage {
  pathname: string;
  url: string;
}

export async function uploadImageToBlob(
  buffer: Buffer | Uint8Array,
  filename: string,
  contentType: string
): Promise<UploadedBlobImage> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'capture.jpg';
  const key = `benz-tech/${Date.now()}-${safeName}`;
  // Always pass a standalone Uint8Array — workerd R2 is more reliable than Node Buffer views.
  // Buffer is a Uint8Array subclass; copy into a plain Uint8Array for R2.
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  await putObject(key, copy, { contentType });
  return {
    pathname: key,
    url: buildImageProxyUrl(key),
  };
}

export async function fetchPrivateBlobAsDataUrl(pathname: string): Promise<string> {
  if (!isAllowedImagePathname(pathname)) {
    throw new Error('Invalid image pathname');
  }

  const result = await getObjectBuffer(pathname);
  if (!result) {
    throw new Error('Image not found in object storage');
  }
  const base64 = result.buffer.toString('base64');
  const contentType = result.contentType || 'image/png';
  return `data:${contentType};base64,${base64}`;
}

/** Vision-optimized fetch — downscales and JPEG-encodes before Grok base64 upload. */
export async function fetchPrivateBlobAsVisionDataUrl(pathname: string): Promise<string> {
  if (!isAllowedImagePathname(pathname)) {
    throw new Error('Invalid image pathname');
  }

  const started = Date.now();
  const result = await withTimeout(
    getObjectBuffer(pathname),
    BLOB_GET_TIMEOUT_MS,
    'storage.get vision'
  );
  if (!result) {
    throw new Error('Image not found in object storage');
  }
  const getMs = Date.now() - started;
  const dataUrl = await withTimeout(
    bufferToVisionDataUrl(result.buffer, result.contentType || 'image/jpeg'),
    VISION_PREP_TIMEOUT_MS,
    'vision.prep sharp'
  );
  logger.info('storage.vision_fetch_ok', {
    pathname,
    bytes: result.buffer.length,
    getMs,
    totalMs: Date.now() - started,
  });
  return dataUrl;
}

export async function streamPrivateBlob(pathname: string): Promise<StoredObjectStream | null> {
  if (!isAllowedImagePathname(pathname)) {
    return null;
  }
  return getObject(pathname);
}
