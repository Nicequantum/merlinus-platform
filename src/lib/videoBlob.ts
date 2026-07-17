import { randomUUID } from 'crypto';
import { get, put } from '@vercel/blob';
import { networkRetryDelayMs, sleep } from './networkErrors';

const BLOB_PUT_MAX_ATTEMPTS = 3;

function getBlobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured');
  }
  return token;
}

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
  // UUID keys — avoid Date.now() collisions / predictable overwrites.
  const key = `benz-tech/video/${safeDealer}/${randomUUID()}-${safeName}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < BLOB_PUT_MAX_ATTEMPTS; attempt++) {
    try {
      const blob = await put(key, buffer, {
        access: 'private',
        contentType,
        token: getBlobToken(),
        addRandomSuffix: false,
      });
      return { pathname: blob.pathname, url: blob.url };
    } catch (error) {
      lastError = error;
      if (attempt === BLOB_PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Video blob upload failed');
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
  let lastError: unknown;

  for (let attempt = 0; attempt < BLOB_PUT_MAX_ATTEMPTS; attempt++) {
    try {
      const blob = await put(key, buffer, {
        access: 'private',
        contentType,
        token: getBlobToken(),
        addRandomSuffix: false,
      });
      return { pathname: blob.pathname, url: blob.url };
    } catch (error) {
      lastError = error;
      if (attempt === BLOB_PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Video frame upload failed');
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
  let lastError: unknown;

  for (let attempt = 0; attempt < BLOB_PUT_MAX_ATTEMPTS; attempt++) {
    try {
      const blob = await put(key, buffer, {
        access: 'private',
        contentType,
        token: getBlobToken(),
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { pathname: blob.pathname, url: blob.url };
    } catch (error) {
      lastError = error;
      if (attempt === BLOB_PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Video chunk upload failed');
}

export async function fetchPrivateVideoChunkAsBuffer(pathname: string): Promise<Buffer> {
  if (!isAllowedVideoChunkPathname(pathname)) {
    throw new Error('Invalid video chunk path');
  }
  const result = await get(pathname, { access: 'private', token: getBlobToken() });
  if (!result) throw new Error('Video chunk not found in storage');
  const ab = await new Response(result.stream).arrayBuffer();
  return Buffer.from(ab);
}

export async function streamPrivateVideoBlob(pathname: string) {
  if (!isAllowedVideoPathname(pathname) && !isAllowedVideoFramePathname(pathname)) {
    return null;
  }
  const result = await get(pathname, { access: 'private', token: getBlobToken() });
  return result;
}

export async function fetchPrivateVideoAsBuffer(pathname: string): Promise<Buffer> {
  const result = await streamPrivateVideoBlob(pathname);
  if (!result) throw new Error('Video not found in storage');
  const ab = await new Response(result.stream).arrayBuffer();
  return Buffer.from(ab);
}
