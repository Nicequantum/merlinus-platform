/**
 * Client-safe idempotency key helpers (no server-only imports).
 */

const KEY_MAX = 128;
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function normalizeIdempotencyKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim();
  if (!KEY_RE.test(key) || key.length > KEY_MAX) return null;
  return key;
}

export function readIdempotencyKeyFromRequest(request: {
  headers: { get(name: string): string | null };
}): string | null {
  return normalizeIdempotencyKey(request.headers.get('Idempotency-Key'));
}

/** Metadata fragment stored on ro.create audit rows. */
export function idempotencyMetadata(key: string): { idempotencyKey: string } {
  return { idempotencyKey: key };
}
