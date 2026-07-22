/**
 * One-time MFA backup codes — bcrypt hashed at rest (encrypted JSON blob).
 */
import { randomBytes, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';

const BACKUP_CODE_COUNT = 8;
const BCRYPT_ROUNDS = 10;

/** Human-friendly 8-char codes (no ambiguous 0/O/1/I). */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const buf = randomBytes(8);
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += alphabet[buf[j]! % alphabet.length];
    }
    // Format XXXX-XXXX for readability
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  const hashes: string[] = [];
  for (const code of codes) {
    hashes.push(await bcrypt.hash(normalizeBackupCode(code), BCRYPT_ROUNDS));
  }
  return hashes;
}

export function encryptBackupCodeHashes(hashes: string[]): string {
  return encryptSensitiveText(JSON.stringify(hashes));
}

export function decryptBackupCodeHashes(encrypted: string | null | undefined): string[] {
  if (!encrypted?.trim()) return [];
  try {
    const raw = decryptSensitiveText(encrypted);
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === 'string' && h.length > 0);
  } catch {
    return [];
  }
}

export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Verify a backup code against hashed list. Returns remaining hashes if matched
 * (matched hash removed), or null if invalid.
 */
export async function consumeBackupCode(
  hashes: string[],
  code: string
): Promise<string[] | null> {
  const normalized = normalizeBackupCode(code);
  if (normalized.length < 6 || normalized.length > 16) return null;

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i]!;
    try {
      const ok = await bcrypt.compare(normalized, hash);
      // Also accept formatted form comparison via re-hash of dashed input
      const okDashed = ok
        ? true
        : await bcrypt.compare(code.trim().toUpperCase(), hash);
      if (ok || okDashed) {
        return hashes.filter((_, idx) => idx !== i);
      }
    } catch {
      // continue
    }
  }
  return null;
}

/** Constant-time-ish check that a string looks like a backup code (not 6-digit TOTP). */
export function looksLikeBackupCode(code: string): boolean {
  const n = normalizeBackupCode(code);
  if (/^\d{6}$/.test(n)) return false;
  return n.length >= 8 && n.length <= 16 && /^[A-Z0-9]+$/.test(n);
}

export function backupCodesEqual(a: string, b: string): boolean {
  const na = Buffer.from(normalizeBackupCode(a), 'utf8');
  const nb = Buffer.from(normalizeBackupCode(b), 'utf8');
  if (na.length !== nb.length) return false;
  return timingSafeEqual(na, nb);
}
