import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { readRuntimeEnv } from '@/lib/runtimeEnv';

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

/** Server pepper for share passcodes (not user-supplied). Prefer SEARCH_HMAC_KEY. */
function passcodePepper(): string {
  return (
    process.env.SEARCH_HMAC_KEY?.trim() ||
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    'merlin-share-passcode-dev-pepper'
  );
}

/**
 * Hash customer share passcode with HMAC-SHA256 + pepper (v2: prefix).
 * Legacy unsalted SHA-256 hashes remain verifiable for existing shares.
 */
export function hashPasscode(passcode: string): string {
  const digest = createHmac('sha256', passcodePepper()).update(passcode, 'utf8').digest('hex');
  return `v2:${digest}`;
}

function legacyHashPasscode(passcode: string): string {
  return createHash('sha256').update(passcode).digest('hex');
}

function timingSafeHexEqual(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'utf8');
    const b = Buffer.from(bHex, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Timing-safe compare of provided passcode against stored hash (v2 HMAC or legacy SHA-256). */
export function verifyPasscodeHash(provided: string, expectedHash: string): boolean {
  if (!provided || !expectedHash) return false;
  if (expectedHash.startsWith('v2:')) {
    return timingSafeHexEqual(hashPasscode(provided), expectedHash);
  }
  // Legacy unsalted SHA-256 (pre-audit shares)
  return timingSafeHexEqual(legacyHashPasscode(provided), expectedHash);
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

function isWorkersDevHost(host: string): boolean {
  return host.toLowerCase().endsWith('.workers.dev');
}

function originFromEnvCandidate(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    if (isLocalhostHost(u.host)) return null;
    return stripTrailingSlash(`${u.protocol}//${u.host}`);
  } catch {
    return null;
  }
}

/**
 * Resolve the public app origin for customer share links.
 *
 * Priority:
 * 1. PUBLIC_SHARE_HOST / CUSTOMER_SHARE_HOST / NEXT_PUBLIC_* / MERLIN_BASE_URL / APP_URL
 *    (prefer custom domains over *.workers.dev when multiple are set)
 * 2. Request Host (Workers) — last resort when no env is set
 * 3. VERCEL_URL
 *
 * Reads Cloudflare Worker env bindings (not only process.env) so dashboard vars work.
 * Never emit http://localhost for production share links.
 */
const SHARE_HOST_ENV_KEYS = [
  'PUBLIC_SHARE_HOST',
  'CUSTOMER_SHARE_HOST',
  'NEXT_PUBLIC_SHARE_HOST',
  'NEXT_PUBLIC_APP_URL',
  'MERLIN_BASE_URL',
  'APP_URL',
  'CF_PAGES_URL',
] as const;

export type ShareHostSource =
  | (typeof SHARE_HOST_ENV_KEYS)[number]
  | 'request-host'
  | 'vercel-url'
  | 'localhost-fallback';

export function resolveAppBaseUrlDetailed(request?: Request | null): {
  origin: string;
  source: ShareHostSource;
} {
  const parsed: Array<{ origin: string; source: ShareHostSource }> = [];
  for (const key of SHARE_HOST_ENV_KEYS) {
    // Runtime CF Worker bindings (not only process.env) — fixes "I set the var but links still workers.dev"
    const raw = readRuntimeEnv(key);
    const origin = originFromEnvCandidate(raw);
    if (origin) parsed.push({ origin, source: key });
  }

  // Prefer first custom (non-workers.dev) origin.
  const custom = parsed.find((entry) => {
    try {
      return !isWorkersDevHost(new URL(entry.origin).host);
    } catch {
      return false;
    }
  });
  if (custom) return custom;
  if (parsed[0]) return parsed[0];

  if (request) {
    const host =
      request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
      request.headers.get('host')?.trim() ||
      '';
    if (host && !isLocalhostHost(host) && !isWorkersDevHost(host)) {
      const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto = protoHeader === 'http' ? 'http' : 'https';
      return {
        origin: stripTrailingSlash(`${proto}://${host}`),
        source: 'request-host',
      };
    }
    // Request is workers.dev with no custom env — last resort (internal / misconfigured).
    if (host && !isLocalhostHost(host)) {
      const protoHeader = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto = protoHeader === 'http' ? 'http' : 'https';
      return {
        origin: stripTrailingSlash(`${proto}://${host}`),
        source: 'request-host',
      };
    }
  }

  const vercel = readRuntimeEnv('VERCEL_URL');
  if (vercel) {
    return {
      origin: stripTrailingSlash(`https://${vercel.replace(/^https?:\/\//i, '')}`),
      source: 'vercel-url',
    };
  }

  return { origin: 'http://localhost:3000', source: 'localhost-fallback' };
}

export function resolveAppBaseUrl(request?: Request | null): string {
  return resolveAppBaseUrlDetailed(request).origin;
}

export function buildCustomerViewerUrl(
  token: string,
  request?: Request | null
): string {
  const base = resolveAppBaseUrl(request);
  return `${base}/v/${encodeURIComponent(token)}`;
}

/** Same as buildCustomerViewerUrl + which env/host source won (for ops debugging). */
export function buildCustomerViewerUrlDetailed(
  token: string,
  request?: Request | null
): { url: string; origin: string; source: ShareHostSource } {
  const { origin, source } = resolveAppBaseUrlDetailed(request);
  return {
    url: `${origin}/v/${encodeURIComponent(token)}`,
    origin,
    source,
  };
}

/**
 * Max video size for MPI walkarounds.
 * Default 2 GiB — supports ~15–20 min HD tablet captures.
 * Override with VIDEO_INSPECTION_MAX_MB (integer megabytes).
 */
export function getVideoMaxBytes(): number {
  const raw = process.env.VIDEO_INSPECTION_MAX_MB;
  if (raw !== undefined && raw !== '') {
    const mb = Number(raw);
    if (Number.isFinite(mb) && mb > 0) return Math.floor(mb * 1024 * 1024);
  }
  // 2 GiB default — no practical bay length cap for multipoint walkarounds
  return 2048 * 1024 * 1024;
}

/**
 * Max recording duration (seconds).
 * Default 2 hours (7200s) — long enough for complex multi-issue vehicles.
 * Override with VIDEO_INSPECTION_MAX_DURATION_SEC (e.g. 86400 for a full day).
 */
export function getVideoMaxDurationSec(): number {
  const raw = process.env.VIDEO_INSPECTION_MAX_DURATION_SEC;
  if (raw !== undefined && raw !== '') {
    const sec = Number(raw);
    if (Number.isFinite(sec) && sec > 0) return Math.floor(sec);
  }
  return 7200;
}
