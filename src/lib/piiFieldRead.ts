import 'server-only';

import {
  decryptOptionalSensitiveText,
  decryptSensitiveText,
} from '@/lib/encryption';
import { logger } from '@/lib/logger';

export interface TolerantPiiRead {
  value: string;
  /** True when ciphertext was present but decryption failed (legacy key mismatch, corruption). */
  decryptFailed: boolean;
}

type RoNumberRow = {
  roNumberEncrypted?: string | null;
};

type DescriptionRow = {
  descriptionEncrypted?: string | null;
};

type AdvisorDisplayNameRow = {
  displayNameEncrypted?: string | null;
};

type EncryptedTextRow = {
  encrypted?: string | null;
};

function readTolerant(decrypt: () => string, encrypted: string, logKey: string): TolerantPiiRead {
  try {
    return { value: decrypt(), decryptFailed: false };
  } catch (error) {
    logger.error(logKey, {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { value: '', decryptFailed: true };
  }
}

export function readRoNumberTolerant(row: RoNumberRow): TolerantPiiRead {
  const encrypted = row.roNumberEncrypted?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptSensitiveText(encrypted),
    encrypted,
    'pii.read_ro_number_failed'
  );
}

/** Phase 5: encrypted-only RO number read. */
export function readRoNumberFromDb(row: RoNumberRow): string {
  return readRoNumberTolerant(row).value;
}

export function readDescriptionTolerant(row: DescriptionRow): TolerantPiiRead {
  const encrypted = row.descriptionEncrypted?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptSensitiveText(encrypted),
    encrypted,
    'pii.read_description_failed'
  );
}

/** Phase 5: encrypted-only line description read. */
export function readDescriptionFromDb(row: DescriptionRow): string {
  return readDescriptionTolerant(row).value;
}

export function readAdvisorDisplayNameTolerant(row: AdvisorDisplayNameRow): TolerantPiiRead {
  const encrypted = row.displayNameEncrypted?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptSensitiveText(encrypted),
    encrypted,
    'pii.read_advisor_name_failed'
  );
}

/** Phase 5: encrypted-only advisor display name read. */
export function readAdvisorDisplayNameFromDb(row: AdvisorDisplayNameRow): string {
  return readAdvisorDisplayNameTolerant(row).value;
}

/**
 * PII column read with legacy plaintext support.
 * Pre-encryption rows stored human-readable text in *Encrypted columns; decryptSensitiveText
 * returns those values unchanged while still decrypting real AES-GCM ciphertext.
 */
export function readEncryptedPiiTolerant(row: EncryptedTextRow): TolerantPiiRead {
  const encrypted = row.encrypted?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptSensitiveText(encrypted),
    encrypted,
    'pii.read_encrypted_field_failed'
  );
}

/** Tolerant PII read — detail routes must not 500 when one legacy ciphertext is unreadable. */
export function readEncryptedPiiFromDb(row: EncryptedTextRow): string {
  return readEncryptedPiiTolerant(row).value;
}

export function readSensitiveTextTolerant(ciphertext: string | null | undefined): TolerantPiiRead {
  const encrypted = ciphertext?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptSensitiveText(encrypted),
    encrypted,
    'pii.read_sensitive_text_failed'
  );
}

export function readOptionalSensitiveTextTolerant(
  ciphertext: string | null | undefined
): TolerantPiiRead {
  const encrypted = ciphertext?.trim();
  if (!encrypted) return { value: '', decryptFailed: false };
  return readTolerant(
    () => decryptOptionalSensitiveText(encrypted) ?? '',
    encrypted,
    'pii.read_optional_sensitive_text_failed'
  );
}

export function appendPiiDecryptWarning(
  warnings: string[],
  label: string,
  read: TolerantPiiRead
): void {
  if (read.decryptFailed) {
    warnings.push(label);
  }
}