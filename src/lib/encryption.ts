import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { logger } from './logger';

/**
 * L4 — Encryption key rotation (Phase 1 accepted risk)
 *
 * Phase 1 uses a single static DATA_ENCRYPTION_KEY per deployment. Rotating the key
 * requires a planned maintenance window and `npm run db:reencrypt` (see docs/Reencryption-Runbook.md).
 * There is no automatic online re-key or multi-key envelope encryption in this release.
 *
 * Accepted for initial pilot with compensating controls:
 * - Keys stored only in Vercel env (never in repo); 64-hex format validated at build
 * - Legacy scrypt salt fallback for rows encrypted before H7 hardening
 * - Tolerant decrypt reads surface piiDecryptWarnings instead of silent data loss
 *
 * Planned Phase 2: dual-key envelope rotation with background re-encryption job.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/** H7: Salt derived from deployment key material — not a hardcoded global constant. */
function getScryptSalt(): string {
  const explicit = process.env.ENCRYPTION_SALT?.trim();
  if (explicit) return explicit;
  const secret = getDataEncryptionSecret();
  return createHash('sha256').update(`merlin-pii-salt:${secret}`).digest('hex');
}

const LEGACY_SCRYPT_SALT = 'benz-tech-pii-salt';

function getDataEncryptionSecret(): string {
  // H17: AES uses DATA_ENCRYPTION_KEY only (no ENCRYPTION_KEY fallback in this module).
  // Legacy ENCRYPTION_KEY is mapped to DATA_ENCRYPTION_KEY at startup via applyLegacyEncryptionEnvAliases().
  const secret = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be set (min 32 chars) for PII encryption');
  }
  return secret;
}

function deriveKeyFromSalt(salt: string): Buffer {
  return scryptSync(getDataEncryptionSecret(), salt, 32);
}

/** New encryptions use key-derived salt (H7); legacy rows used LEGACY_SCRYPT_SALT. */
function getPrimaryKey(): Buffer {
  return deriveKeyFromSalt(getScryptSalt());
}

function getDecryptKeyCandidates(): Buffer[] {
  const primary = getPrimaryKey();
  const legacy = deriveKeyFromSalt(LEGACY_SCRYPT_SALT);
  return primary.equals(legacy) ? [primary] : [primary, legacy];
}

export function encryptPII(plaintext: string): string {
  if (!plaintext) return '';
  const key = getPrimaryKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptWithKey(ciphertext: string, key: Buffer): string {
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function decryptPII(ciphertext: string): string {
  if (!ciphertext) return '';
  const keys = getDecryptKeyCandidates();
  let lastError: unknown;
  for (const key of keys) {
    try {
      return decryptWithKey(ciphertext, key);
    } catch (error) {
      lastError = error;
    }
  }
  // H6: loud failure after legacy + current salt attempts.
  logger.error('encryption.decrypt_failed', {
    error: lastError instanceof Error ? lastError.message : 'unknown',
  });
  throw new Error(
    'PII decryption failed — verify DATA_ENCRYPTION_KEY matches the key used to encrypt data'
  );
}

export function encryptStringArray(items: string[]): string {
  if (!items.length) return '';
  return encryptPII(JSON.stringify(items));
}

function isLegacyJsonArray(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('[');
}

export function decryptStringArray(ciphertext: string): string[] {
  if (!ciphertext) return [];
  if (isLegacyJsonArray(ciphertext)) {
    try {
      const parsed = JSON.parse(ciphertext);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  let raw: string;
  try {
    raw = decryptPII(ciphertext);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    return [];
  }
  return [];
}

/** Encrypt a sensitive text field for storage (technician notes, etc.). */
export function encryptSensitiveText(plaintext: string): string {
  if (!plaintext) return '';
  return encryptPII(plaintext);
}

/** Decrypt a sensitive text field, falling back to legacy plaintext values. */
export function decryptSensitiveText(ciphertext: string): string {
  if (!ciphertext) return '';
  if (!isLikelyEncryptedPayload(ciphertext)) {
    return ciphertext;
  }
  return decryptPII(ciphertext);
}

export function decryptOptionalSensitiveText(ciphertext: string | null): string | undefined {
  if (!ciphertext) return undefined;
  const value = decryptSensitiveText(ciphertext);
  return value || undefined;
}

export function encryptOptionalSensitiveText(plaintext: string | undefined | null): string | null {
  if (!plaintext) return null;
  const encrypted = encryptPII(plaintext);
  return encrypted || null;
}

export interface ComplaintsPayload {
  complaints: string[];
  labels?: string[];
}

/** Backward-compatible: legacy payloads are plain string arrays. */
export function decryptComplaintsPayload(ciphertext: string): ComplaintsPayload {
  if (!ciphertext) return { complaints: [] };
  if (isLegacyJsonArray(ciphertext)) {
    try {
      const parsed = JSON.parse(ciphertext);
      if (Array.isArray(parsed)) {
        return { complaints: parsed.map(String) };
      }
    } catch {
      return { complaints: [] };
    }
  }
  let raw: string;
  try {
    raw = decryptPII(ciphertext);
  } catch {
    return { complaints: [] };
  }
  if (!raw) return { complaints: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { complaints: parsed.map(String) };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.complaints)) {
      const complaints = parsed.complaints.map(String);
      const labels = Array.isArray(parsed.labels) ? parsed.labels.map(String) : undefined;
      if (labels && labels.length === complaints.length) {
        return { complaints, labels };
      }
      return { complaints };
    }
  } catch {
    return { complaints: [] };
  }
  return { complaints: [] };
}

export function encryptComplaintsPayload(complaints: string[], labels?: string[]): string {
  const hasLabels = Boolean(labels && labels.length === complaints.length);
  const payload: ComplaintsPayload | string[] = hasLabels ? { complaints, labels } : complaints;
  return encryptPII(JSON.stringify(payload));
}

/** True when a stored value already looks like an AES-GCM ciphertext (base64, not legacy JSON). */
export function isLikelyEncryptedPayload(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (!/^[A-Za-z0-9+/]+=*$/.test(trimmed)) return false;
  try {
    const data = Buffer.from(trimmed, 'base64');
    return data.length >= IV_LENGTH + 16 + 1;
  } catch {
    return false;
  }
}

function isLegacyJsonObject(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith('{');
}

/** Encrypt a JSON-serializable object for database storage (e.g. extracted diagnostic data). */
export function encryptJsonObject(value: unknown): string {
  return encryptPII(JSON.stringify(value ?? {}));
}

/** Decrypt a JSON object field, falling back to legacy plaintext JSON values. */
export function decryptJsonObject<T>(ciphertext: string, fallback: T): T {
  if (!ciphertext) return fallback;
  if (isLegacyJsonObject(ciphertext)) {
    try {
      return JSON.parse(ciphertext) as T;
    } catch {
      return fallback;
    }
  }
  let raw: string;
  try {
    raw = decryptPII(ciphertext);
  } catch {
    return fallback;
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Re-encrypt a legacy plaintext string if it is not already encrypted. */
export function migratePlaintextToEncrypted(plaintext: string): string {
  if (!plaintext) return '';
  if (isLikelyEncryptedPayload(plaintext)) return plaintext;
  return encryptPII(plaintext);
}

/** Re-encrypt a legacy optional plaintext string if it is not already encrypted. */
export function migratePlaintextOptionalToEncrypted(plaintext: string | null): string | null {
  if (!plaintext) return null;
  if (isLikelyEncryptedPayload(plaintext)) return plaintext;
  return encryptPII(plaintext);
}

/** Re-encrypt a legacy plaintext JSON string array if it is not already encrypted. */
export function migratePlaintextStringArrayToEncrypted(raw: string): string {
  if (!raw) return '';
  if (isLikelyEncryptedPayload(raw)) return raw;
  if (isLegacyJsonArray(raw)) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return encryptStringArray(parsed.map(String));
    } catch {
      return '';
    }
  }
  return encryptStringArray([raw]);
}

/** Re-encrypt legacy plaintext JSON object data if it is not already encrypted. */
export function migratePlaintextJsonObjectToEncrypted(raw: string): string {
  if (!raw) return encryptJsonObject({});
  if (isLikelyEncryptedPayload(raw)) return raw;
  if (isLegacyJsonObject(raw)) {
    try {
      return encryptJsonObject(JSON.parse(raw));
    } catch {
      return encryptJsonObject({});
    }
  }
  return encryptJsonObject({});
}

/** Re-encrypt legacy plaintext complaint payloads if they are not already encrypted. */
export function migratePlaintextComplaintsToEncrypted(raw: string): string {
  if (!raw) return encryptComplaintsPayload([]);
  if (isLikelyEncryptedPayload(raw)) return raw;
  if (isLegacyJsonArray(raw)) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return encryptComplaintsPayload(parsed.map(String));
    } catch {
      return encryptComplaintsPayload([]);
    }
  }
  if (isLegacyJsonObject(raw)) {
    try {
      const parsed = JSON.parse(raw) as { complaints?: unknown; labels?: unknown };
      if (Array.isArray(parsed.complaints)) {
        const complaints = parsed.complaints.map(String);
        const labels = Array.isArray(parsed.labels) ? parsed.labels.map(String) : undefined;
        return encryptComplaintsPayload(complaints, labels);
      }
    } catch {
      return encryptComplaintsPayload([]);
    }
  }
  return encryptComplaintsPayload([]);
}