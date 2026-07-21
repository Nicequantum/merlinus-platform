/**
 * P1-3 — Minimal TOTP (RFC 6238) using Node crypto only — no extra deps.
 * 30s period, 6 digits, SHA-1 (authenticator-app compatible).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const PERIOD_S = 30;
const DIGITS = 6;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  return base32Encode(buf);
}

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(secret: string): Buffer {
  const cleaned = secret.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const str = String(code % 10 ** DIGITS).padStart(DIGITS, '0');
  return str;
}

export function generateTotpCode(secretBase32: string, atMs = Date.now()): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / PERIOD_S);
  return hotp(secret, counter);
}

/** Accept current and ±1 step window. */
export function verifyTotpCode(
  secretBase32: string,
  code: string,
  atMs = Date.now()
): boolean {
  const expected = code.replace(/\s/g, '').trim();
  if (!/^\d{6}$/.test(expected)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 1000 / PERIOD_S);
  for (const delta of [-1, 0, 1]) {
    const candidate = hotp(secret, counter + delta);
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function buildOtpAuthUri(input: {
  secret: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = encodeURIComponent(input.issuer || 'Merlinus');
  const account = encodeURIComponent(input.accountName);
  return `otpauth://totp/${issuer}:${account}?secret=${input.secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`;
}
