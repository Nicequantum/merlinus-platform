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

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h.startsWith('localhost:') ||
    h === '127.0.0.1' ||
    h.startsWith('127.0.0.1:') ||
    h === '[::1]' ||
    h.startsWith('[::1]:')
  );
}

/**
 * Resolve the public app origin for customer share links.
 * Prefer explicit env; on Cloudflare Workers fall back to the request Host
 * so links never ship as http://localhost:3000 in production.
 */
export function resolveAppBaseUrl(request?: Request | null): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.MERLIN_BASE_URL,
    process.env.APP_URL,
    process.env.CF_PAGES_URL,
  ];
  for (const raw of candidates) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      const u = new URL(v.includes('://') ? v : `https://${v}`);
      if (!isLocalhostHost(u.host)) {
        return stripTrailingSlash(`${u.protocol}//${u.host}`);
      }
    } catch {
      // try next
    }
  }

  if (request) {
    const host =
      request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      request.headers.get('host')?.trim() ||
      '';
    if (host && !isLocalhostHost(host)) {
      const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto = protoHeader === 'http' ? 'http' : 'https';
      return stripTrailingSlash(`${proto}://${host}`);
    }
  }

  if (process.env.VERCEL_URL?.trim()) {
    return stripTrailingSlash(`https://${process.env.VERCEL_URL.trim()}`);
  }

  return 'http://localhost:3000';
}

export function buildCustomerViewerUrl(
  token: string,
  request?: Request | null
): string {
  const base = resolveAppBaseUrl(request);
  return `${base}/v/${encodeURIComponent(token)}`;
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
