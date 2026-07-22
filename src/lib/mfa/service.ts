/**
 * MFA service — UserMfa + Technician denormalized flags.
 * Zero-downtime: reads UserMfa first, falls back to Technician.mfaSecretEncrypted.
 */
import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { decryptSensitiveText, encryptSensitiveText } from '@/lib/encryption';
import { revokeAllSessionsForTechnician } from '@/lib/sessionRevocation';
import {
  decryptBackupCodeHashes,
  encryptBackupCodeHashes,
  generateBackupCodes,
  hashBackupCodes,
  looksLikeBackupCode,
  consumeBackupCode,
} from '@/lib/mfa/backupCodes';
import { buildOtpAuthUri, generateTotpSecret, verifyTotpCode } from '@/lib/mfa/totp';

export interface MfaEnrollmentStart {
  secret: string;
  otpauthUrl: string;
  /** Present when qrcode package available server-side */
  qrCodeDataUrl?: string | null;
}

export async function isMfaEnabledForTechnician(technicianId: string): Promise<boolean> {
  return withRlsBypass(async () => {
    const userMfa = await getRlsDb().userMfa.findUnique({
      where: { technicianId },
      select: { enabled: true },
    });
    if (userMfa?.enabled) return true;
    const tech = await getRlsDb().technician.findUnique({
      where: { id: technicianId },
      select: { mfaEnabled: true, mfaEnrolledAt: true },
    });
    return Boolean(tech?.mfaEnabled && tech.mfaEnrolledAt);
  });
}

async function resolveTotpSecret(technicianId: string): Promise<string | null> {
  const db = getRlsDb();
  const userMfa = await db.userMfa.findUnique({
    where: { technicianId },
    select: { secretEncrypted: true },
  });
  if (userMfa?.secretEncrypted) {
    try {
      return decryptSensitiveText(userMfa.secretEncrypted);
    } catch {
      // fall through
    }
  }
  const tech = await db.technician.findUnique({
    where: { id: technicianId },
    select: { mfaSecretEncrypted: true },
  });
  if (!tech?.mfaSecretEncrypted) return null;
  try {
    return decryptSensitiveText(tech.mfaSecretEncrypted);
  } catch {
    return null;
  }
}

/**
 * Begin enrollment — stores encrypted secret (not yet enabled).
 */
export async function beginMfaEnrollment(input: {
  technicianId: string;
  accountName: string;
  rotate?: boolean;
}): Promise<MfaEnrollmentStart> {
  return withRlsBypass(async () => {
    const db = getRlsDb();
    const existing = await db.userMfa.findUnique({
      where: { technicianId: input.technicianId },
      select: { enabled: true },
    });
    if (existing?.enabled && !input.rotate) {
      throw new Error('MFA is already enabled. Use rotate to re-enroll.');
    }

    const secret = generateTotpSecret();
    const encrypted = encryptSensitiveText(secret);

    await db.userMfa.upsert({
      where: { technicianId: input.technicianId },
      create: {
        technicianId: input.technicianId,
        secretEncrypted: encrypted,
        enabled: false,
        backupCodesEncrypted: null,
        enrolledAt: null,
      },
      update: {
        secretEncrypted: encrypted,
        enabled: false,
        backupCodesEncrypted: null,
        enrolledAt: null,
        updatedAt: new Date(),
      },
    });

    // Mirror denormalized Technician columns
    await db.technician.update({
      where: { id: input.technicianId },
      data: {
        mfaSecretEncrypted: encrypted,
        mfaEnabled: false,
        mfaEnrolledAt: null,
        mfaBackupCodesEncrypted: null,
      },
    });

    const otpauthUrl = buildOtpAuthUri({
      secret,
      accountName: input.accountName,
      issuer: 'Merlinus',
    });

    let qrCodeDataUrl: string | null = null;
    try {
      const QRCode = (await import('qrcode')).default;
      qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
        width: 220,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
    } catch {
      qrCodeDataUrl = null;
    }

    return { secret, otpauthUrl, qrCodeDataUrl };
  });
}

/**
 * Confirm TOTP enrollment → enable MFA, issue backup codes, bump session version.
 */
export async function confirmMfaEnrollment(input: {
  technicianId: string;
  code: string;
  revokeSessions?: boolean;
}): Promise<{ backupCodes: string[] }> {
  return withRlsBypass(async () => {
    const secret = await resolveTotpSecret(input.technicianId);
    if (!secret) {
      throw new Error('Start enrollment first via POST /api/auth/mfa/setup.');
    }
    if (!verifyTotpCode(secret, input.code)) {
      throw new Error('Invalid authentication code. Check your authenticator app.');
    }

    const plainCodes = generateBackupCodes();
    const hashes = await hashBackupCodes(plainCodes);
    const backupEncrypted = encryptBackupCodeHashes(hashes);
    const now = new Date();

    const db = getRlsDb();
    await db.userMfa.upsert({
      where: { technicianId: input.technicianId },
      create: {
        technicianId: input.technicianId,
        secretEncrypted: encryptSensitiveText(secret),
        enabled: true,
        backupCodesEncrypted: backupEncrypted,
        enrolledAt: now,
      },
      update: {
        enabled: true,
        backupCodesEncrypted: backupEncrypted,
        enrolledAt: now,
        updatedAt: now,
      },
    });

    await db.technician.update({
      where: { id: input.technicianId },
      data: {
        mfaEnabled: true,
        mfaEnrolledAt: now,
        mfaBackupCodesEncrypted: backupEncrypted,
      },
    });

    if (input.revokeSessions !== false) {
      await revokeAllSessionsForTechnician(input.technicianId);
    }

    return { backupCodes: plainCodes };
  });
}

/**
 * Login-time or step-up verification: TOTP or single-use backup code.
 */
export async function verifyMfaFactor(input: {
  technicianId: string;
  code: string;
}): Promise<{ ok: true; method: 'totp' | 'backup' } | { ok: false; error: string }> {
  return withRlsBypass(async () => {
    const enabled = await isMfaEnabledForTechnician(input.technicianId);
    if (!enabled) {
      return { ok: false, error: 'MFA is not enabled for this account.' };
    }

    const code = input.code.trim();
    if (looksLikeBackupCode(code)) {
      const db = getRlsDb();
      const userMfa = await db.userMfa.findUnique({
        where: { technicianId: input.technicianId },
        select: { backupCodesEncrypted: true },
      });
      let hashes = decryptBackupCodeHashes(userMfa?.backupCodesEncrypted);
      if (hashes.length === 0) {
        const tech = await db.technician.findUnique({
          where: { id: input.technicianId },
          select: { mfaBackupCodesEncrypted: true },
        });
        hashes = decryptBackupCodeHashes(tech?.mfaBackupCodesEncrypted);
      }
      const remaining = await consumeBackupCode(hashes, code);
      if (!remaining) {
        return { ok: false, error: 'Invalid backup code.' };
      }
      const encrypted = encryptBackupCodeHashes(remaining);
      await db.userMfa.updateMany({
        where: { technicianId: input.technicianId },
        data: { backupCodesEncrypted: encrypted, updatedAt: new Date() },
      });
      await db.technician.update({
        where: { id: input.technicianId },
        data: { mfaBackupCodesEncrypted: encrypted },
      });
      return { ok: true, method: 'backup' };
    }

    const secret = await resolveTotpSecret(input.technicianId);
    if (!secret) {
      return { ok: false, error: 'MFA secret missing. Re-enroll MFA.' };
    }
    if (!verifyTotpCode(secret, code)) {
      return { ok: false, error: 'Invalid authentication code.' };
    }
    return { ok: true, method: 'totp' };
  });
}

/** Regenerate backup codes (requires valid TOTP). */
export async function regenerateBackupCodes(input: {
  technicianId: string;
  totpCode: string;
}): Promise<{ backupCodes: string[] }> {
  return withRlsBypass(async () => {
    const secret = await resolveTotpSecret(input.technicianId);
    if (!secret || !verifyTotpCode(secret, input.totpCode)) {
      throw new Error('Invalid authentication code.');
    }
    const plainCodes = generateBackupCodes();
    const hashes = await hashBackupCodes(plainCodes);
    const backupEncrypted = encryptBackupCodeHashes(hashes);
    const db = getRlsDb();
    await db.userMfa.updateMany({
      where: { technicianId: input.technicianId },
      data: { backupCodesEncrypted: backupEncrypted, updatedAt: new Date() },
    });
    await db.technician.update({
      where: { id: input.technicianId },
      data: { mfaBackupCodesEncrypted: backupEncrypted },
    });
    return { backupCodes: plainCodes };
  });
}

export async function getMfaStatusForTechnician(technicianId: string): Promise<{
  mfaEnabled: boolean;
  enrolledAt: string | null;
  backupCodesRemaining: number;
}> {
  return withRlsBypass(async () => {
    const userMfa = await getRlsDb().userMfa.findUnique({
      where: { technicianId },
    });
    if (userMfa) {
      const hashes = decryptBackupCodeHashes(userMfa.backupCodesEncrypted);
      return {
        mfaEnabled: userMfa.enabled,
        enrolledAt: userMfa.enrolledAt?.toISOString() ?? null,
        backupCodesRemaining: hashes.length,
      };
    }
    const tech = await getRlsDb().technician.findUnique({
      where: { id: technicianId },
      select: {
        mfaEnabled: true,
        mfaEnrolledAt: true,
        mfaBackupCodesEncrypted: true,
      },
    });
    return {
      mfaEnabled: Boolean(tech?.mfaEnabled),
      enrolledAt: tech?.mfaEnrolledAt?.toISOString() ?? null,
      backupCodesRemaining: decryptBackupCodeHashes(tech?.mfaBackupCodesEncrypted).length,
    };
  });
}
