import 'server-only';

/**
 * Video MPI / frame / chunk storage — Cloudflare R2 via objectStorage abstraction.
 */

import { randomUUID } from 'crypto';
import {
  deleteObject,
  getObject,
  getObjectBuffer,
  putObject,
  type StoredObjectStream,
} from '@/lib/storage/objectStorage';
import { requireR2Bucket } from '@/lib/storage/r2';

export function isAllowedVideoPathname(pathname: string): boolean {
  return pathname.startsWith('benz-tech/video/') && !pathname.includes('..');
}

export function isAllowedVideoFramePathname(pathname: string): boolean {
  return (
    (pathname.startsWith('benz-tech/video/') || pathname.startsWith('benz-tech/video-frame/')) &&
    !pathname.includes('..')
  );
}

/** PR-M1b — temporary chunk parts for resumable assembly. */
export function isAllowedVideoChunkPathname(pathname: string): boolean {
  return pathname.startsWith('benz-tech/video-chunk/') && !pathname.includes('..');
}

export interface UploadedVideoBlob {
  pathname: string;
  /** R2 has no public URL — empty string; clients use authenticated media routes. */
  url: string;
}

export async function uploadVideoToBlob(
  buffer: Buffer,
  filename: string,
  contentType: string,
  dealershipId: string
): Promise<UploadedVideoBlob> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const safeDealer = dealershipId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const key = `benz-tech/video/${safeDealer}/${randomUUID()}-${safeName}`;
  await putObject(key, buffer, { contentType });
  return { pathname: key, url: '' };
}

export async function uploadVideoFrameToBlob(
  buffer: Buffer,
  filename: string,
  contentType: string,
  dealershipId: string
): Promise<UploadedVideoBlob> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const safeDealer = dealershipId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const key = `benz-tech/video-frame/${safeDealer}/${randomUUID()}-${safeName}`;
  await putObject(key, buffer, { contentType });
  return { pathname: key, url: '' };
}

/** PR-M1b — store one resumable upload chunk (overwrite-safe fixed key per session+index). */
export async function uploadVideoChunkToBlob(
  buffer: Buffer,
  dealershipId: string,
  sessionId: string,
  chunkIndex: number,
  contentType = 'application/octet-stream'
): Promise<UploadedVideoBlob> {
  const safeDealer = dealershipId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const index = Math.max(0, Math.floor(chunkIndex));
  const key = `benz-tech/video-chunk/${safeDealer}/${safeSession}/${index}.part`;
  await putObject(key, buffer, { contentType });
  return { pathname: key, url: '' };
}

export async function fetchPrivateVideoChunkAsBuffer(pathname: string): Promise<Buffer> {
  if (!isAllowedVideoChunkPathname(pathname)) {
    throw new Error('Invalid video chunk path');
  }
  const result = await getObjectBuffer(pathname);
  if (!result) throw new Error('Video chunk not found in storage');
  return result.buffer;
}

/**
 * Assemble chunk pathnames into a final video object without holding the full
 * multi-hundred-MB buffer when R2 multipart is available (long walkarounds).
 * Falls back to sequential concat for smaller files or when multipart is missing.
 */
export async function assembleVideoChunksToBlob(
  chunkPathnames: string[],
  filename: string,
  contentType: string,
  dealershipId: string
): Promise<UploadedVideoBlob & { sizeBytes: number }> {
  if (chunkPathnames.length === 0) {
    throw new Error('No video chunks to assemble');
  }
  for (const p of chunkPathnames) {
    if (!isAllowedVideoChunkPathname(p)) {
      throw new Error('Invalid video chunk path during assemble');
    }
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'inspection.webm';
  const safeDealer = dealershipId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  const finalKey = `benz-tech/video/${safeDealer}/${randomUUID()}-${safeName}`;
  const bucket = requireR2Bucket();

  // Multipart path: one chunk in memory at a time (safe for 15–20 min HD videos).
  if (typeof bucket.createMultipartUpload === 'function' && chunkPathnames.length > 1) {
    const multipart = await bucket.createMultipartUpload(finalKey, {
      httpMetadata: {
        contentType,
        cacheControl: 'private, no-store',
      },
    });
    const uploadedParts: Array<{ etag: string; partNumber: number }> = [];
    let sizeBytes = 0;
    try {
      for (let i = 0; i < chunkPathnames.length; i++) {
        const buf = await fetchPrivateVideoChunkAsBuffer(chunkPathnames[i]!);
        if (buf.byteLength <= 0) {
          throw new Error(`Empty video chunk at index ${i}`);
        }
        sizeBytes += buf.byteLength;
        // R2 multipart part numbers are 1-based
        const partNumber = i + 1;
        const copy = new Uint8Array(buf.byteLength);
        copy.set(buf);
        const part = await multipart.uploadPart(partNumber, copy);
        uploadedParts.push({ etag: part.etag, partNumber: part.partNumber || partNumber });
      }
      await multipart.complete(uploadedParts);
      return { pathname: finalKey, url: '', sizeBytes };
    } catch (error) {
      try {
        await multipart.abort();
      } catch {
        // ignore abort errors
      }
      throw error;
    }
  }

  // Small / single-chunk fallback — concat then put
  const parts: Buffer[] = [];
  let total = 0;
  for (const path of chunkPathnames) {
    const buf = await fetchPrivateVideoChunkAsBuffer(path);
    parts.push(buf);
    total += buf.byteLength;
  }
  if (total <= 0) throw new Error('Assembled video is empty');
  const assembled = Buffer.concat(parts, total);
  await putObject(finalKey, assembled, { contentType });
  return { pathname: finalKey, url: '', sizeBytes: total };
}

export async function streamPrivateVideoBlob(
  pathname: string,
  options?: { range?: import('@/lib/storage/objectStorage').ByteRangeRequest }
): Promise<StoredObjectStream | null> {
  if (!isAllowedVideoPathname(pathname) && !isAllowedVideoFramePathname(pathname)) {
    return null;
  }
  return getObject(pathname, options?.range ? { range: options.range } : undefined);
}

export async function fetchPrivateVideoAsBuffer(pathname: string): Promise<Buffer> {
  if (!isAllowedVideoPathname(pathname) && !isAllowedVideoFramePathname(pathname)) {
    throw new Error('Invalid video path');
  }
  const result = await getObjectBuffer(pathname);
  if (!result) throw new Error('Video not found in storage');
  return result.buffer;
}

/**
 * Best-effort cleanup of temporary chunk parts after complete/fail.
 * Never throws — partial cleanup is better than orphan accumulation.
 */
export async function deleteVideoChunksBestEffort(pathnames: string[]): Promise<void> {
  const keys = pathnames.filter((p) => typeof p === 'string' && isAllowedVideoChunkPathname(p));
  if (keys.length === 0) return;
  try {
    // R2 delete accepts string | string[]
    await deleteObject(keys.length === 1 ? keys[0]! : keys);
  } catch {
    // ignore — orphans expire operationally via session TTL + prefix hygiene
  }
}
