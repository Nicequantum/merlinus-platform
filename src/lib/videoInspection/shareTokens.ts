import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Opaque share tokens are 32 random bytes → ~43 base64url chars. */
export const SHARE_TOKEN_MIN_LEN = 32;
export const SHARE_TOKEN_MAX_LEN = 64;

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token.trim()).digest('hex');
}

/** Reject malformed share tokens before DB lookup (public routes stay unauthenticated). */
export function isValidRawShareToken(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const token = raw.trim();
  if (token.length < SHARE_TOKEN_MIN_LEN || token.length > SHARE_TOKEN_MAX_LEN) return false;
  // base64url alphabet only — no padding
  return /^[A-Za-z0-9_-]+$/.test(token);
}

export function hashPasscode(passcode: string): string {
  return createHash('sha256').update(passcode).digest('hex');
}

/** Timing-safe compare of provided passcode against stored SHA-256 hex hash. */
export function verifyPasscodeHash(provided: string, expectedHash: string): boolean {
  if (!provided || !expectedHash) return false;
  const a = Buffer.from(hashPasscode(provided), 'utf8');
  const b = Buffer.from(expectedHash, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildCustomerViewerUrl(token: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.MERLIN_BASE_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  return `${base.replace(/\/$/, '')}/v/${encodeURIComponent(token)}`;
}

export function getVideoMaxBytes(): number {
  const mb = Number(process.env.VIDEO_INSPECTION_MAX_MB);
  if (Number.isFinite(mb) && mb > 0) return Math.floor(mb * 1024 * 1024);
  return 100 * 1024 * 1024;
}

export function getVideoMaxDurationSec(): number {
  const sec = Number(process.env.VIDEO_INSPECTION_MAX_DURATION_SEC);
  if (Number.isFinite(sec) && sec > 0) return Math.floor(sec);
  return 300;
}
