/** PR-M1b — chunked upload limits (shared client/server). */

/** Default chunk size for resumable uploads (2 MiB). */
export const VIDEO_UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

/** Hard cap on chunk count (supports up to ~100 MiB at 2 MiB chunks). */
export const VIDEO_UPLOAD_MAX_CHUNKS = 64;

/** Upload session TTL. */
export const VIDEO_UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Per-chunk client retry attempts. */
export const VIDEO_CHUNK_CLIENT_RETRIES = 3;

export function computeChunkCount(totalBytes: number, chunkBytes = VIDEO_UPLOAD_CHUNK_BYTES): number {
  if (totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / chunkBytes);
}
