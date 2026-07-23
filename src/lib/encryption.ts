import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { logger } from './logger';

/**
 * L4 / P1-5 — Encryption key rotation
 *
 * Encrypt always uses the current DATA_ENCRYPTION_KEY.
 * Decrypt tries, in order:
 *   1. Current key + current salt (H7 key-derived or ENCRYPTION_SALT)
 *   2. Previous key DATA_ENCRYPTION_KEY_PREVIOUS (online dual-key window)
 *   3. Current key + legacy scrypt salt (pre-H7 rows)
 *   4. Previous key + legacy scrypt salt
 *
 * Rotation procedure: set PREVIOUS=old, KEY=new → deploy → run reencrypt → remove PREVIOUS.
 * See docs/Reencryption-Runbook.md.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

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

/** Optional previous key for dual-key decrypt during rotation (min 32 chars). */
function getPreviousEncryptionSecret(): string | null {
  const secret = process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim();
  if (!secret || secret.length < 32) return null;
  return secret;
}

function scryptSaltForSecret(secret: string): string {
  const explicit = process.env.ENCRYPTION_SALT?.trim();
  if (explicit) return explicit;
  return createHash('sha256').update(`merlin-pii-salt:${secret}`).digest('hex');
}

function deriveKey(secret: string, salt: string): Buffer {
  return scryptSync(secret, salt, 32);
}

/** New encryptions use current key + current salt only. */
function getPrimaryKey(): Buffer {
  const secret = getDataEncryptionSecret();
  return deriveKey(secret, scryptSaltForSecret(secret));
}

/**
 * All keys that may decrypt historical ciphertext during rotation + legacy salt window.
 * Order: current primary, previous primary, current+legacy salt, previous+legacy salt.
 */
export function getDecryptKeyCandidates(): Buffer[] {
  const secrets: string[] = [getDataEncryptionSecret()];
  const prev = getPreviousEncryptionSecret();
  if (prev && prev !== secrets[0]) secrets.push(prev);

  const keys: Buffer[] = [];
  const seen = new Set<string>();
  const push = (buf: Buffer) => {
    const id = buf.toString('hex');
    if (seen.has(id)) return;
    seen.add(id);
    keys.push(buf);
  };

  for (const secret of secrets) {
    push(deriveKey(secret, scryptSaltForSecret(secret)));
    push(deriveKey(secret, LEGACY_SCRYPT_SALT));
  }
  return keys;
}

/** True when dual-key rotation window is active (previous key configured). */
export function isDualKeyRotationActive(): boolean {
  return Boolean(getPreviousEncryptionSecret());
}

/** SHA-256 fingerprint of a secret (first 16 hex chars) — never returns key material. */
export function fingerprintSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16);
}

export function getPrimaryKeyFingerprint(): string {
  return fingerprintSecret(getDataEncryptionSecret());
}

export function getPreviousKeyFingerprint(): string | null {
  const prev = getPreviousEncryptionSecret();
  return prev ? fingerprintSecret(prev) : null;
}

/** Cryptographically strong 48-byte key as base64url (store as DATA_ENCRYPTION_KEY). */
export function generateDataEncryptionKey(): string {
  return randomBytes(48).toString('base64url');
}

export interface EncryptionKeyStatus {
  primaryFingerprint: string;
  previousFingerprint: string | null;
  dualKeyActive: boolean;
  /** Days previous key has been configured is unknown in-process; flag only. */
  recommendCloseDualKey: boolean;
  candidateDecryptKeys: number;
}

export function getEncryptionKeyStatus(): EncryptionKeyStatus {
  const dualKeyActive = isDualKeyRotationActive();
  return {
    primaryFingerprint: getPrimaryKeyFingerprint(),
    previousFingerprint: getPreviousKeyFingerprint(),
    dualKeyActive,
    recommendCloseDualKey: dualKeyActive,
    candidateDecryptKeys: getDecryptKeyCandidates().length,
  };
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
  // H6: loud failure after current + previous + legacy salt attempts.
  logger.error('encryption.decrypt_failed', {
    error: lastError instanceof Error ? lastError.message : 'unknown',
    dualKey: isDualKeyRotationActive(),
    candidateCount: keys.length,
  });
  throw new Error(
    'PII decryption failed — verify DATA_ENCRYPTION_KEY (and DATA_ENCRYPTION_KEY_PREVIOUS during rotation) matches the key used to encrypt data'
  );
}

/**
 * True when AES-GCM ciphertext decrypts with the **current primary key only**
 * (no previous dual-key candidates). Used after re-encrypt to detect rows still
 * bound to DATA_ENCRYPTION_KEY_PREVIOUS.
 */
export function canDecryptWithPrimaryKeyOnly(ciphertext: string): boolean {
  if (!ciphertext || !isLikelyEncryptedPayload(ciphertext)) return true;
  try {
    decryptWithKey(ciphertext, getPrimaryKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * True when ciphertext cannot open with primary alone but succeeds under dual-key
 * (or full candidate list). Indicates row still on previous key during/after rotation.
 */
export function requiresPreviousKeyToDecrypt(ciphertext: string): boolean {
  if (!ciphertext || !isLikelyEncryptedPayload(ciphertext)) return false;
  if (canDecryptWithPrimaryKeyOnly(ciphertext)) return false;
  try {
    decryptPII(ciphertext);
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-encrypt ciphertext with the current primary key.
 * Returns null if decrypt fails or value is empty / not ciphertext-shaped.
 * Used by rotation batch jobs.
 * Zero-downtime: dual-key decrypt still works while PREVIOUS is set.
 */
export function reencryptCiphertextWithCurrentKey(ciphertext: string): string | null {
  if (!ciphertext || !isLikelyEncryptedPayload(ciphertext)) return null;
  try {
    const plain = decryptPII(ciphertext);
    return encryptPII(plain);
  } catch {
    return null;
  }
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