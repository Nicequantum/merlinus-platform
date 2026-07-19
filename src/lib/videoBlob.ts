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
