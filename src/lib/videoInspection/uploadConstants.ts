/** PR-M1b — chunked upload limits (shared client/server). */

/**
 * Chunk size for resumable uploads (4 MiB).
 * Larger chunks = fewer Worker subrequests on 10–20 min walkaround videos.
 * Still well under Cloudflare request body limits.
 */
export const VIDEO_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * Hard cap on chunk count.
 * At 4 MiB chunks this supports up to ~4 GiB (env VIDEO_INSPECTION_MAX_MB still caps).
 * 1024 chunks keeps complete-assemble subrequests under Worker limits.
 */
export const VIDEO_UPLOAD_MAX_CHUNKS = 1024;

/** Upload session TTL (6 hours) — long walkarounds + slow bay Wi‑Fi. */
export const VIDEO_UPLOAD_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

/** Per-chunk client retry attempts (network / 5xx / 429). */
export const VIDEO_CHUNK_CLIENT_RETRIES = 8;

/** Client request timeouts (ms) — long enough for large parts on shop Wi‑Fi. */
export const VIDEO_UPLOAD_INIT_TIMEOUT_MS = 60_000;
export const VIDEO_UPLOAD_CHUNK_TIMEOUT_MS = 120_000;
export const VIDEO_UPLOAD_COMPLETE_TIMEOUT_MS = 600_000;
export const VIDEO_UPLOAD_SINGLE_TIMEOUT_MS = 300_000;

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
