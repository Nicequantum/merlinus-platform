import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildMfaSessionFlags,
  isMfaEnforcementEnabled,
  roleRequiresMfaEnrollment,
} from '@/lib/mfa/policy';
import { generateTotpCode, generateTotpSecret, verifyTotpCode } from '@/lib/mfa/totp';
import {
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  looksLikeBackupCode,
  normalizeBackupCode,
} from '@/lib/mfa/backupCodes';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('MFA fortress — TOTP + backup codes', () => {
  it('TOTP roundtrip with window', () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    assert.equal(verifyTotpCode(secret, code), true);
    assert.equal(verifyTotpCode(secret, '000000'), false);
  });

  it('backup codes generate, hash, and consume once', async () => {
    const codes = generateBackupCodes(4);
    assert.equal(codes.length, 4);
    assert.ok(looksLikeBackupCode(codes[0]!));
    assert.equal(looksLikeBackupCode('123456'), false);
    const hashes = await hashBackupCodes(codes);
    const remaining = await consumeBackupCode(hashes, codes[0]!);
    assert.ok(remaining);
    assert.equal(remaining!.length, hashes.length - 1);
    const again = await consumeBackupCode(remaining!, codes[0]!);
    assert.equal(again, null);
    // formatted vs normalized
    const dashed = codes[1]!;
    const plain = normalizeBackupCode(dashed);
    const hashes2 = await hashBackupCodes([plain]);
    const ok = await consumeBackupCode(hashes2, dashed);
    assert.ok(ok);
  });

  it('enforcement flag and role policy', () => {
    const off = { ...process.env };
    delete off.MERLIN_MFA_ENFORCE;
    assert.equal(isMfaEnforcementEnabled(off), false);
    assert.equal(roleRequiresMfaEnrollment('manager', off), false);

    const on = { MERLIN_MFA_ENFORCE: 'true' } as NodeJS.ProcessEnv;
    assert.equal(roleRequiresMfaEnrollment('manager', on), true);
    assert.equal(roleRequiresMfaEnrollment('technician', on), false);
    const needs = buildMfaSessionFlags({
      role: 'manager',
      mfaEnabled: false,
      mfaEnrolledAt: null,
      env: on,
    });
    assert.equal(needs.mfaRequired, true);
  });

  it('routes and login challenge exist', () => {
    assert.match(readSrc('src/app/api/auth/mfa/setup/route.ts'), /beginMfaEnrollment/);
    assert.match(readSrc('src/app/api/auth/mfa/verify/route.ts'), /confirmMfaEnrollment/);
    assert.match(readSrc('src/app/api/auth/mfa/login-verify/route.ts'), /verifyPendingMfaToken/);
    assert.match(readSrc('src/app/api/auth/mfa/backup-codes/route.ts'), /regenerateBackupCodes/);
    assert.match(readSrc('src/app/api/auth/login/route.ts'), /requiresMfa|createPendingMfaToken/);
    assert.match(readSrc('src/lib/apex/loginResolver.ts'), /mfa_required/);
    assert.match(readSrc('src/lib/mfa/challenge.ts'), /pending_mfa/);
    assert.match(readSrc('src/lib/mfa/service.ts'), /UserMfa|userMfa/);
  });

  it('client login shells handle MFA step', () => {
    assert.match(readSrc('src/components/LoginView.tsx'), /onMfaVerify/);
    assert.match(readSrc('src/components/apex/ApexLoginShell.tsx'), /mfa_required/);
    assert.match(readSrc('src/components/MfaSettingsPanel.tsx'), /mfaSetup|backup/);
    assert.match(readSrc('src/components/ForcedMfaEnrollScreen.tsx'), /qrCodeDataUrl|backupCodes/);
  });

  it('schema has UserMfa model', () => {
    assert.match(readSrc('prisma/schema.prisma'), /model UserMfa/);
    assert.match(readSrc('prisma/schema.prisma'), /mfa_backup_codes_encrypted/);
  });

  it('audit actions and health include MFA', () => {
    assert.match(readSrc('src/lib/audit.ts'), /auth\.mfa_success/);
    assert.match(readSrc('src/lib/audit.ts'), /auth\.mfa_challenge/);
    assert.match(readSrc('src/lib/healthChecks.ts'), /checkMfaPolicyHealth/);
    assert.match(readSrc('src/lib/rate-limit.ts'), /authMfa/);
  });
});
