/**
 * MFA service — UserMfa + Technician denormalized flags.
 * Zero-downtime: reads UserMfa first, falls back to Technician.mfaSecretEncrypted.
 */
import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import {
  decryptSensitiveText,
  encryptSensitiveText,
  warmEncryptionKeyring,
} from '@/lib/encryption';
import { logger } from '@/lib/logger';
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
  // Keyring must be loaded — MFA secrets are DEK-encrypted; cold login used to skip warm.
  await warmEncryptionKeyring();
  const db = getRlsDb();
  const userMfa = await db.userMfa.findUnique({
    where: { technicianId },
    select: { secretEncrypted: true },
  });
  if (userMfa?.secretEncrypted) {
    try {
      const secret = decryptSensitiveText(userMfa.secretEncrypted);
      if (secret?.trim()) return secret;
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
    const secret = decryptSensitiveText(tech.mfaSecretEncrypted);
    return secret?.trim() ? secret : null;
  } catch {
    return null;
  }
}

export type MfaMaterialHealth = {
  enabled: boolean;
  secretReadable: boolean;
  backupReadable: boolean;
  /** True when MFA is on but ciphertext cannot open after keyring warm (rotation damage). */
  corrupt: boolean;
};

/**
 * Detect MFA ciphertext that cannot decrypt after key rotation / keyring load.
 * Used to auto-recover locked-out owners without a working authenticator.
 */
export async function inspectMfaMaterialHealth(technicianId: string): Promise<MfaMaterialHealth> {
  return withRlsBypass(async () => {
    await warmEncryptionKeyring();
    const db = getRlsDb();
    const userMfa = await db.userMfa.findUnique({
      where: { technicianId },
      select: {
        enabled: true,
        secretEncrypted: true,
        backupCodesEncrypted: true,
      },
    });
    const tech = await db.technician.findUnique({
      where: { id: technicianId },
      select: {
        mfaEnabled: true,
        mfaEnrolledAt: true,
        mfaSecretEncrypted: true,
        mfaBackupCodesEncrypted: true,
      },
    });
    const enabled = Boolean(
      userMfa?.enabled || (tech?.mfaEnabled && tech?.mfaEnrolledAt)
    );
    const secretCipher =
      userMfa?.secretEncrypted?.trim() || tech?.mfaSecretEncrypted?.trim() || '';
    const backupCipher =
      userMfa?.backupCodesEncrypted?.trim() ||
      tech?.mfaBackupCodesEncrypted?.trim() ||
      '';

    let secretReadable = false;
    if (secretCipher) {
      try {
        const s = decryptSensitiveText(secretCipher);
        secretReadable = Boolean(s?.trim());
      } catch {
        secretReadable = false;
      }
    }

    let backupReadable = false;
    if (backupCipher) {
      try {
        const hashes = decryptBackupCodeHashes(backupCipher);
        backupReadable = hashes.length > 0;
      } catch {
        backupReadable = false;
      }
    }

    // Corrupt = enrolled/enabled with ciphertext present but neither factor can open.
    const hasMaterial = Boolean(secretCipher || backupCipher);
    const corrupt = enabled && hasMaterial && !secretReadable && !backupReadable;
    return { enabled, secretReadable, backupReadable, corrupt };
  });
}

/**
 * Clear MFA enrollment without TOTP — recovery path after DEK rotation damage only.
 * Callers must audit.
 */
export async function clearMfaEnrollmentForRecovery(
  technicianId: string,
  reason: string
): Promise<{ cleared: boolean }> {
  return withRlsBypass(async () => {
    const db = getRlsDb();
    await db.userMfa.deleteMany({ where: { technicianId } });
    await db.technician.update({
      where: { id: technicianId },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaEnrolledAt: null,
        mfaBackupCodesEncrypted: null,
      },
    });
    logger.warn('mfa.recovery_cleared', {
      technicianId,
      reason: reason.slice(0, 120),
    });
    return { cleared: true };
  });
}

/**
 * If MFA is flagged on but secrets are unreadable after keyring warm, clear enrollment.
 * Returns true when recovery ran (caller should skip MFA challenge / complete login).
 */

/** One-shot ops unlock: MERLIN_MFA_FORCE_CLEAR_IDENTIFIERS=email1,d7,username */
export function forceClearMfaIdentifiersFromEnv(): Set<string> {
  const raw = process.env.MERLIN_MFA_FORCE_CLEAR_IDENTIFIERS?.trim() ?? '';
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const v = part.trim().toLowerCase();
    if (v) set.add(v);
  }
  return set;
}

export async function forceClearMfaIfAllowlisted(input: {
  technicianId: string;
  email?: string | null;
  d7Number?: string | null;
  apexUsername?: string | null;
}): Promise<{ cleared: boolean }> {
  const allow = forceClearMfaIdentifiersFromEnv();
  if (allow.size === 0) return { cleared: false };
  const candidates = [
    input.email,
    input.d7Number,
    input.apexUsername,
    input.technicianId,
  ]
    .filter(Boolean)
    .map((s) => String(s).trim().toLowerCase());
  if (!candidates.some((c) => allow.has(c))) return { cleared: false };
  await clearMfaEnrollmentForRecovery(
    input.technicianId,
    'env_force_clear_identifiers'
  );
  return { cleared: true };
}

export async function recoverCorruptMfaIfNeeded(
  technicianId: string
): Promise<{ recovered: boolean; reason?: string }> {
  const health = await inspectMfaMaterialHealth(technicianId);
  if (!health.corrupt) {
    return { recovered: false };
  }
  await clearMfaEnrollmentForRecovery(
    technicianId,
    'encrypted_mfa_unreadable_after_key_rotation'
  );
  return {
    recovered: true,
    reason: 'encrypted_mfa_unreadable_after_key_rotation',
  };
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
 * Prefer `secret` from in-app client generation (never logged); falls back to pending setup row.
 */
export async function confirmMfaEnrollment(input: {
  technicianId: string;
  code: string;
  /** Client-generated secret for full in-app enrollment */
  secret?: string;
  revokeSessions?: boolean;
}): Promise<{ backupCodes: string[] }> {
  return withRlsBypass(async () => {
    const clientSecret = input.secret?.replace(/\s/g, '').toUpperCase().trim();
    let secret: string | null = null;

    if (clientSecret) {
      if (clientSecret.length < 16 || !/^[A-Z2-7]+=*$/.test(clientSecret)) {
        throw new Error('Invalid authenticator secret format.');
      }
      if (!verifyTotpCode(clientSecret, input.code)) {
        throw new Error('Invalid authentication code. Check your authenticator app.');
      }
      secret = clientSecret;
    } else {
      secret = await resolveTotpSecret(input.technicianId);
      if (!secret) {
        throw new Error('Start enrollment first (in-app setup or POST /api/auth/mfa/setup).');
      }
      if (!verifyTotpCode(secret, input.code)) {
        throw new Error('Invalid authentication code. Check your authenticator app.');
      }
    }

    const plainCodes = generateBackupCodes();
    const hashes = await hashBackupCodes(plainCodes);
    const backupEncrypted = encryptBackupCodeHashes(hashes);
    const now = new Date();
    const secretEncrypted = encryptSensitiveText(secret);

    const db = getRlsDb();
    await db.userMfa.upsert({
      where: { technicianId: input.technicianId },
      create: {
        technicianId: input.technicianId,
        secretEncrypted,
        enabled: true,
        backupCodesEncrypted: backupEncrypted,
        enrolledAt: now,
      },
      update: {
        secretEncrypted,
        enabled: true,
        backupCodesEncrypted: backupEncrypted,
        enrolledAt: now,
        updatedAt: now,
      },
    });

    await db.technician.update({
      where: { id: input.technicianId },
      data: {
        mfaSecretEncrypted: secretEncrypted,
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
}): Promise<
  | { ok: true; method: 'totp' | 'backup' }
  | { ok: false; error: string; code?: 'MFA_CORRUPT' | 'MFA_INVALID' }
> {
  return withRlsBypass(async () => {
    await warmEncryptionKeyring();
    const enabled = await isMfaEnabledForTechnician(input.technicianId);
    if (!enabled) {
      return { ok: false, error: 'MFA is not enabled for this account.' };
    }

    // Rotation damage: secrets exist but cannot decrypt — surface for auto-recovery.
    const health = await inspectMfaMaterialHealth(input.technicianId);
    if (health.corrupt) {
      return {
        ok: false,
        code: 'MFA_CORRUPT',
        error:
          'Authenticator data cannot be read after encryption key changes. Sign in again — MFA will be cleared so you can re-enroll.',
      };
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
      // Enabled flag on but no readable secret — same recovery path as corrupt.
      return {
        ok: false,
        code: 'MFA_CORRUPT',
        error:
          'MFA secret is missing or unreadable. Sign in again to clear and re-enroll MFA.',
      };
    }
    if (!verifyTotpCode(secret, code)) {
      return { ok: false, error: 'Invalid authentication code.', code: 'MFA_INVALID' };
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

/**
 * Self-service disable MFA — requires a valid TOTP or backup code.
 * Clears UserMfa + Technician mirrors and revokes all sessions.
 */
export async function disableMfaForTechnician(input: {
  technicianId: string;
  code: string;
}): Promise<void> {
  const verified = await verifyMfaFactor({
    technicianId: input.technicianId,
    code: input.code,
  });
  if (!verified.ok) {
    throw new Error(verified.error || 'Invalid authentication code.');
  }

  await withRlsBypass(async () => {
    const db = getRlsDb();
    await db.userMfa.deleteMany({ where: { technicianId: input.technicianId } });
    await db.technician.update({
      where: { id: input.technicianId },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaEnrolledAt: null,
        mfaBackupCodesEncrypted: null,
      },
    });
    await revokeAllSessionsForTechnician(input.technicianId);
  });
}

/**
 * Manager/owner admin reset — clears MFA for a locked-out user at the same rooftop.
 * Does not require the target's TOTP (ops recovery path). Audited by the route.
 */
export async function adminResetMfaForTechnician(input: {
  targetTechnicianId: string;
  dealershipId: string;
  actorTechnicianId: string;
}): Promise<{ targetName: string; targetRole: string }> {
  return withRlsBypass(async () => {
    const db = getRlsDb();
    const target = await db.technician.findFirst({
      where: {
        id: input.targetTechnicianId,
        dealershipId: input.dealershipId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        role: true,
        isAdmin: true,
        mfaEnabled: true,
      },
    });
    if (!target) {
      throw new Error('User not found at this dealership.');
    }
    if (target.id === input.actorTechnicianId) {
      throw new Error('Use Settings → MFA to disable your own authenticator (requires your code).');
    }

    await db.userMfa.deleteMany({ where: { technicianId: target.id } });
    await db.technician.update({
      where: { id: target.id },
      data: {
        mfaEnabled: false,
        mfaSecretEncrypted: null,
        mfaEnrolledAt: null,
        mfaBackupCodesEncrypted: null,
      },
    });
    await revokeAllSessionsForTechnician(target.id);

    return {
      targetName: target.name,
      targetRole: target.isAdmin ? 'admin' : target.role,
    };
  });
}

export type DealershipMfaRosterRow = {
  technicianId: string;
  name: string;
  role: string;
  isAdmin: boolean;
  mfaEnabled: boolean;
  enrolledAt: string | null;
  elevated: boolean;
};

/**
 * MFA enrollment roster for the active rooftop (elevated roles first).
 * No secrets returned — flags only for manager compliance view.
 */
export async function listDealershipMfaRoster(dealershipId: string): Promise<{
  enforcementEnabled: boolean;
  requiredRoles: string[];
  rows: DealershipMfaRosterRow[];
  elevatedEnrolled: number;
  elevatedTotal: number;
}> {
  const { isMfaEnforcementEnabled, parseMfaRequiredRoles } = await import('@/lib/mfa/policy');
  const required = parseMfaRequiredRoles();
  const enforcementEnabled = isMfaEnforcementEnabled();

  return withRlsBypass(async () => {
    const techs = await getRlsDb().technician.findMany({
      where: { dealershipId, isActive: true },
      select: {
        id: true,
        name: true,
        role: true,
        isAdmin: true,
        mfaEnabled: true,
        mfaEnrolledAt: true,
      },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      take: 200,
    });

    const rows: DealershipMfaRosterRow[] = techs.map((t) => {
      const role = (t.role || '').toLowerCase();
      const elevated = required.has(role) || (t.isAdmin && required.has('admin'));
      return {
        technicianId: t.id,
        name: t.name,
        role: t.isAdmin && role !== 'admin' ? `${role}+admin` : role,
        isAdmin: t.isAdmin,
        mfaEnabled: Boolean(t.mfaEnabled && t.mfaEnrolledAt),
        enrolledAt: t.mfaEnrolledAt?.toISOString() ?? null,
        elevated,
      };
    });

    rows.sort((a, b) => {
      if (a.elevated !== b.elevated) return a.elevated ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const elevatedRows = rows.filter((r) => r.elevated);
    return {
      enforcementEnabled,
      requiredRoles: [...required],
      rows,
      elevatedEnrolled: elevatedRows.filter((r) => r.mfaEnabled).length,
      elevatedTotal: elevatedRows.length,
    };
  });
}
