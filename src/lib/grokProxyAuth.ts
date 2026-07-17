import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { getGrokProxyApiKey } from '@/lib/grokApiKey.shared';

/** Default short-lived proxy token lifetime (seconds). */
export const GROK_PROXY_TOKEN_TTL_SEC = 60;
/** Max clock skew accepted for token exp/iat (seconds). */
const CLOCK_SKEW_SEC = 30;

function base64UrlEncode(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
  return b.toString('base64url');
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function hmacSign(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function safeEqualStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return safeEqualBuffers(ab, bb);
}

export interface GrokProxyTokenClaims {
  iat: number;
  exp: number;
  jti: string;
  v: 1;
}

/**
 * Mint a short-lived bearer token for /api/grok/proxy (dealer nodes).
 * Signed with GROK_PROXY_API_KEY via HMAC-SHA256.
 *
 * Format: v1.<base64url(json)>.<base64url(sig)>
 */
export function createGrokProxyAccessToken(
  ttlSec: number = GROK_PROXY_TOKEN_TTL_SEC,
  secret: string | null = getGrokProxyApiKey()
): string {
  if (!secret) {
    throw new Error('GROK_PROXY_API_KEY is required to mint proxy access tokens');
  }
  const now = Math.floor(Date.now() / 1000);
  const claims: GrokProxyTokenClaims = {
    v: 1,
    iat: now,
    exp: now + Math.max(15, Math.min(ttlSec, 300)),
    jti: randomBytes(12).toString('hex'),
  };
  const payload = base64UrlEncode(JSON.stringify(claims));
  const sig = base64UrlEncode(hmacSign(secret, `v1.${payload}`));
  return `v1.${payload}.${sig}`;
}

/**
 * Verify short-lived proxy token. Timing-safe signature compare.
 */
export function verifyGrokProxyAccessToken(
  token: string,
  secret: string | null = getGrokProxyApiKey()
): boolean {
  if (!secret || !token?.trim()) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;

  let expected: Buffer;
  try {
    expected = hmacSign(secret, `v1.${payloadB64}`);
  } catch {
    return false;
  }

  let provided: Buffer;
  try {
    provided = base64UrlDecode(sigB64);
  } catch {
    return false;
  }
  if (!safeEqualBuffers(expected, provided)) return false;

  try {
    const claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as GrokProxyTokenClaims;
    if (claims.v !== 1 || typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp + CLOCK_SKEW_SEC < now) return false;
    if (claims.iat - CLOCK_SKEW_SEC > now) return false;
    if (claims.exp - claims.iat > 300 + CLOCK_SKEW_SEC) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Authenticate inbound proxy request.
 * Accepts:
 *  1) Short-lived HMAC token (preferred): Authorization: Bearer v1.<payload>.<sig>
 *  2) Legacy static GROK_PROXY_API_KEY as Bearer (timing-safe) — only when
 *     GROK_PROXY_ALLOW_STATIC_BEARER=true (migration break-glass).
 */
export function isValidGrokProxyBearer(request: Request): boolean {
  const expectedKey = getGrokProxyApiKey();
  if (!expectedKey) return false;

  const auth = request.headers.get('authorization')?.trim() ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;

  // Preferred: short-lived signed token
  if (token.startsWith('v1.')) {
    return verifyGrokProxyAccessToken(token, expectedKey);
  }

  // Legacy static key — opt-in only
  const allowStatic =
    process.env.GROK_PROXY_ALLOW_STATIC_BEARER?.trim().toLowerCase() === 'true' ||
    process.env.GROK_PROXY_ALLOW_STATIC_BEARER?.trim() === '1';
  if (!allowStatic) return false;
  return safeEqualStrings(token, expectedKey);
}
