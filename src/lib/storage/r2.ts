import 'server-only';

/**
 * Cloudflare R2 binding resolution (OpenNext + workerd).
 * Binding name must match wrangler.toml: APEX_R2 → bucket apex.
 *
 * Resolution order mirrors D1 (src/lib/d1.ts) so OpenNext request context
 * is preferred — missing ALS/package fallbacks were a common live cause of
 * "storage not available" / generic client toasts on RO photo upload.
 */

export const R2_BINDING_NAME = 'APEX_R2' as const;

/** R2 byte range (matches Workers R2Range). */
export type R2RangeLike =
  | { offset: number; length?: number }
  | { offset?: number; length: number }
  | { suffix: number };

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
  get: (
    key: string,
    options?: { range?: R2RangeLike | Headers }
  ) => Promise<R2ObjectBodyLike | null>;
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
  /** Full object size (even when a range was requested). */
  size?: number;
  body: ReadableStream | null;
  httpMetadata?: { contentType?: string | null } | null;
  /** Present when a range get was used. */
  range?: { offset: number; length: number };
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

/**
 * OpenNext sets `globalThis[Symbol.for("__cloudflare-context__")]` via ALS.
 * Prefer this over package require — most reliable on production Workers.
 */
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

function readOpenNextPackageR2(): R2BucketLike | null {
  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (!req) return null;
    const mod = req('@opennextjs/cloudflare') as {
      getCloudflareContext?: (opts?: { async?: boolean }) => { env?: Record<string, unknown> };
    };
    if (typeof mod.getCloudflareContext !== 'function') return null;
    const ctx = mod.getCloudflareContext({ async: false });
    const bucket = ctx?.env?.[R2_BINDING_NAME];
    if (isR2Bucket(bucket)) return bucket;
  } catch {
    // package graph missing or outside request
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
  // OpenNext production path first (ALS / symbol)
  const fromAls = readOpenNextAlsR2();
  if (fromAls) return fromAls;

  const fromOpenNextPkg = readOpenNextPackageR2();
  if (fromOpenNextPkg) return fromOpenNextPkg;

  const fromWorkers = readWorkersModuleR2();
  if (fromWorkers) return fromWorkers;

  const g = globalThis as typeof globalThis & {
    APEX_R2?: R2BucketLike;
    __CLOUDFLARE_ENV__?: Record<string, unknown>;
  };
  if (isR2Bucket(g.APEX_R2)) return g.APEX_R2;
  if (g.__CLOUDFLARE_ENV__ && isR2Bucket(g.__CLOUDFLARE_ENV__[R2_BINDING_NAME])) {
    return g.__CLOUDFLARE_ENV__[R2_BINDING_NAME] as R2BucketLike;
  }

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
