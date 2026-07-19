/** PR-M1b — chunked upload limits (shared client/server). */

/**
 * Chunk size for resumable uploads (1 MiB).
 * Smaller than 2 MiB so progress advances sooner and Workers stay under request limits.
 */
export const VIDEO_UPLOAD_CHUNK_BYTES = 1 * 1024 * 1024;

/**
 * Hard cap on chunk count.
 * At 1 MiB chunks this supports up to ~200 MiB (env VIDEO_INSPECTION_MAX_MB still caps).
 */
export const VIDEO_UPLOAD_MAX_CHUNKS = 200;

/** Upload session TTL (2 hours). */
export const VIDEO_UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Per-chunk client retry attempts (network / 5xx / 429). */
export const VIDEO_CHUNK_CLIENT_RETRIES = 6;

/** Client request timeouts (ms). */
export const VIDEO_UPLOAD_INIT_TIMEOUT_MS = 45_000;
export const VIDEO_UPLOAD_CHUNK_TIMEOUT_MS = 90_000;
export const VIDEO_UPLOAD_COMPLETE_TIMEOUT_MS = 180_000;
export const VIDEO_UPLOAD_SINGLE_TIMEOUT_MS = 180_000;

/** Max concurrent in-flight chunk uploads (keep 1 for rate-limit + worker stability). */
export const VIDEO_UPLOAD_CHUNK_CONCURRENCY = 1;

export function computeChunkCount(totalBytes: number, chunkBytes = VIDEO_UPLOAD_CHUNK_BYTES): number {
  if (totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / chunkBytes);
}

/** Clamp client totalChunks against server max + byte math. */
export function expectedChunkCount(totalBytes: number, chunkBytes = VIDEO_UPLOAD_CHUNK_BYTES): number {
  return Math.min(VIDEO_UPLOAD_MAX_CHUNKS, Math.max(1, computeChunkCount(totalBytes, chunkBytes)));
}
