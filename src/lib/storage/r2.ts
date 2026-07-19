import 'server-only';

/**
 * Cloudflare R2 binding resolution (OpenNext + workerd).
 * Binding name must match wrangler.toml: APEX_R2 → bucket Apex.
 */

export const R2_BINDING_NAME = 'APEX_R2' as const;

/** Minimal R2 bucket surface used by objectStorage (Workers R2 API). */
export type R2BucketLike = {
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | Blob | null,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
      customMetadata?: Record<string, string>;
    }
  ) => Promise<unknown>;
  get: (key: string) => Promise<R2ObjectBodyLike | null>;
  delete: (keys: string | string[]) => Promise<void>;
  list: (options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }) => Promise<{ objects: Array<{ key: string; size: number }>; truncated: boolean }>;
  head?: (key: string) => Promise<{ key: string; size: number } | null>;
};

export type R2ObjectBodyLike = {
  key?: string;
  size?: number;
  body: ReadableStream | null;
  httpMetadata?: { contentType?: string | null } | null;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

function isR2Bucket(value: unknown): value is R2BucketLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as R2BucketLike).put === 'function' &&
    typeof (value as R2BucketLike).get === 'function' &&
    typeof (value as R2BucketLike).delete === 'function' &&
    typeof (value as R2BucketLike).list === 'function'
  );
}

function readOpenNextAlsR2(): R2BucketLike | null {
  try {
    const ctx = Reflect.get(globalThis, Symbol.for('__cloudflare-context__')) as
      | { env?: Record<string, unknown> }
      | undefined;
    const bucket = ctx?.env?.[R2_BINDING_NAME];
    if (isR2Bucket(bucket)) return bucket;
  } catch {
    // outside request
  }
  return null;
}

function readWorkersModuleR2(): R2BucketLike | null {
  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const workers = req('cloudflare:workers') as { env?: Record<string, unknown> };
    const bucket = workers?.env?.[R2_BINDING_NAME];
    if (isR2Bucket(bucket)) return bucket;
  } catch {
    // not workers
  }
  return null;
}

/** Returns the APEX_R2 binding when running on Cloudflare; otherwise null. */
export function getR2Bucket(): R2BucketLike | null {
  const fromAls = readOpenNextAlsR2();
  if (fromAls) return fromAls;
  const fromWorkers = readWorkersModuleR2();
  if (fromWorkers) return fromWorkers;
  const g = globalThis as typeof globalThis & { APEX_R2?: R2BucketLike };
  if (isR2Bucket(g.APEX_R2)) return g.APEX_R2;
  return null;
}

export function requireR2Bucket(): R2BucketLike {
  const bucket = getR2Bucket();
  if (!bucket) {
    throw new Error(
      'Cloudflare R2 binding APEX_R2 is not available. Check wrangler.toml [[r2_buckets]] binding = "APEX_R2" and redeploy.'
    );
  }
  return bucket;
}

export function isR2Configured(): boolean {
  return getR2Bucket() !== null;
}
