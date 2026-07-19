import 'server-only';

/**
 * Provider-neutral object storage (Cloudflare R2 via APEX_R2 binding).
 * App code should import only from this module — never @vercel/blob or raw R2.
 */

import {
  parseBytesRangeHeader,
  type ByteRangeRequest,
} from '@/lib/storage/byteRange';
import { getR2Bucket, isR2Configured, requireR2Bucket } from '@/lib/storage/r2';
import { networkRetryDelayMs, sleep } from '@/lib/networkErrors';

export type { ByteRangeRequest };
export { parseBytesRangeHeader };

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
  /** Full object size when known. */
  size?: number;
  /** When a byte range was returned: inclusive start/end of this body. */
  rangeOffset?: number;
  rangeLength?: number;
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | ArrayBuffer | string,
  options?: { contentType?: string; cacheControl?: string }
): Promise<StoredObjectMeta> {
  const bucket = requireR2Bucket();
  let lastError: unknown;

  // Always copy into a standalone Uint8Array. Node Buffer / SharedArrayBuffer
  // views can hang or fail R2 put on workerd under multi-tenant load.
  let payload: ArrayBuffer | Uint8Array | string;
  let size: number;
  if (typeof body === 'string') {
    payload = body;
    size = Buffer.byteLength(body);
  } else if (body instanceof ArrayBuffer) {
    payload = body;
    size = body.byteLength;
  } else {
    const view = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    payload = copy;
    size = copy.byteLength;
  }

  for (let attempt = 0; attempt < PUT_MAX_ATTEMPTS; attempt++) {
    try {
      await bucket.put(key, payload, {
        httpMetadata: {
          contentType: options?.contentType,
          cacheControl: options?.cacheControl ?? 'private, no-store',
        },
      });
      return {
        key,
        contentType: options?.contentType,
        size,
      };
    } catch (error) {
      lastError = error;
      if (attempt === PUT_MAX_ATTEMPTS - 1) break;
      await sleep(networkRetryDelayMs(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Object storage put failed');
}

export async function getObject(
  key: string,
  options?: { range?: ByteRangeRequest }
): Promise<StoredObjectStream | null> {
  const bucket = requireR2Bucket();
  const rangeReq = options?.range;
  let r2Range: import('@/lib/storage/r2').R2RangeLike | undefined;
  if (rangeReq && rangeReq.kind === 'suffix') {
    r2Range = { suffix: rangeReq.length };
  } else if (rangeReq && rangeReq.kind === 'bounded') {
    r2Range = { offset: rangeReq.start, length: rangeReq.end - rangeReq.start + 1 };
  }

  const obj = r2Range ? await bucket.get(key, { range: r2Range }) : await bucket.get(key);
  if (!obj || !obj.body) return null;

  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  const fullSize = typeof obj.size === 'number' ? obj.size : undefined;
  if (obj.range && typeof obj.range.offset === 'number' && typeof obj.range.length === 'number') {
    return {
      stream: obj.body,
      contentType,
      size: fullSize,
      rangeOffset: obj.range.offset,
      rangeLength: obj.range.length,
    };
  }
  return {
    stream: obj.body,
    contentType,
    size: fullSize,
  };
}

/**
 * Build a streaming Response for video playback with HTTP Range support.
 * Safari / Chrome require 206 Partial Content for progressive inline video.
 */
export function buildRangedObjectResponse(
  result: StoredObjectStream,
  request: Request,
  options: {
    contentType: string;
    fallbackSize?: number;
  }
): Response {
  const totalSize =
    (typeof result.size === 'number' && result.size > 0 ? result.size : undefined) ??
    (typeof options.fallbackSize === 'number' && options.fallbackSize > 0
      ? options.fallbackSize
      : undefined);

  const baseHeaders: Record<string, string> = {
    'Content-Type': options.contentType || result.contentType || 'application/octet-stream',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': 'inline',
    'Accept-Ranges': 'bytes',
  };

  if (typeof totalSize !== 'number') {
    if (typeof result.rangeLength === 'number') {
      baseHeaders['Content-Length'] = String(result.rangeLength);
    }
    return new Response(result.stream, { status: 200, headers: baseHeaders });
  }

  const rangeHeader = request.headers.get('range') || request.headers.get('Range');
  const parsed = parseBytesRangeHeader(rangeHeader, totalSize);

  if (parsed === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${totalSize}`,
      },
    });
  }

  // If the caller already applied a range get, honor that body as 206.
  if (
    typeof result.rangeOffset === 'number' &&
    typeof result.rangeLength === 'number' &&
    result.rangeLength > 0
  ) {
    const start = result.rangeOffset;
    const end = result.rangeOffset + result.rangeLength - 1;
    return new Response(result.stream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Length': String(result.rangeLength),
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
      },
    });
  }

  if (parsed.kind === 'full') {
    return new Response(result.stream, {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(totalSize),
      },
    });
  }

  // Range requested but object was fetched fully — still advertise full body.
  // Callers should re-fetch with range when possible; fallback is 200 full.
  return new Response(result.stream, {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(totalSize),
    },
  });
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
