import 'server-only';

/**
 * Provider-neutral object storage (Cloudflare R2 via APEX_R2 binding).
 * App code should import only from this module — never @vercel/blob or raw R2.
 */

import { getR2Bucket, isR2Configured, requireR2Bucket } from '@/lib/storage/r2';
import { networkRetryDelayMs, sleep } from '@/lib/networkErrors';

const PUT_MAX_ATTEMPTS = 3;

export interface StoredObjectMeta {
  /** Object key / pathname (stable identifier stored in DB). */
  key: string;
  /** Public app URL when proxied through authenticated routes (optional). */
  url?: string;
  contentType?: string;
  size?: number;
}

export interface StoredObjectStream {
  stream: ReadableStream;
  contentType: string;
  size?: number;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer | string,
  options?: { contentType?: string; cacheControl?: string }
): Promise<StoredObjectMeta> {
  const bucket = requireR2Bucket();
  let lastError: unknown;

  for (let attempt = 0; attempt < PUT_MAX_ATTEMPTS; attempt++) {
    try {
      await bucket.put(key, body, {
        httpMetadata: {
          contentType: options?.contentType,
          cacheControl: options?.cacheControl ?? 'private, no-store',
        },
      });
      return {
        key,
        contentType: options?.contentType,
        size: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
      };
    } catch (error) {
      lastError = error;
      if (attempt === PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Object storage put failed');
}

export async function getObject(key: string): Promise<StoredObjectStream | null> {
  const bucket = requireR2Bucket();
  const obj = await bucket.get(key);
  if (!obj || !obj.body) return null;
  return {
    stream: obj.body,
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
    size: obj.size,
  };
}

export async function getObjectBuffer(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const bucket = requireR2Bucket();
  const obj = await bucket.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return {
    buffer: Buffer.from(ab),
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
  };
}

export async function deleteObject(key: string | string[]): Promise<void> {
  const bucket = requireR2Bucket();
  await bucket.delete(key);
}

export async function listObjects(options?: {
  prefix?: string;
  limit?: number;
}): Promise<Array<{ key: string; size: number }>> {
  const bucket = requireR2Bucket();
  const result = await bucket.list({
    prefix: options?.prefix,
    limit: options?.limit ?? 100,
  });
  return result.objects.map((o) => ({ key: o.key, size: o.size }));
}

/** Health / readiness: true when R2 binding is present (Worker) or false locally. */
export function isObjectStorageConfigured(): boolean {
  return isR2Configured();
}

/** Probe storage with a cheap list (limit 1). Throws if binding missing or list fails. */
export async function probeObjectStorage(): Promise<void> {
  const bucket = getR2Bucket();
  if (!bucket) {
    throw new Error('R2 binding APEX_R2 not configured');
  }
  await bucket.list({ limit: 1 });
}
