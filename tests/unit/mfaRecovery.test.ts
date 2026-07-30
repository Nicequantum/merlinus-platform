import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
function readSrc(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

describe('MFA recovery after key rotation', () => {
  it('warms keyring before resolving TOTP secret', () => {
    const src = readSrc('src/lib/mfa/service.ts');
    assert.match(src, /warmEncryptionKeyring/);
    assert.match(src, /inspectMfaMaterialHealth/);
    assert.match(src, /recoverCorruptMfaIfNeeded/);
    assert.match(src, /MFA_CORRUPT/);
  });

  it('login auto-recovers corrupt MFA before challenge', () => {
    const src = readSrc('src/app/api/auth/login/route.ts');
    assert.match(src, /recoverCorruptMfaIfNeeded/);
    assert.match(src, /forceClearMfaIfAllowlisted/);
  });

  it('login-verify clears MFA_CORRUPT and self-recovery route exists', () => {
    const verify = readSrc('src/app/api/auth/mfa/login-verify/route.ts');
    assert.match(verify, /MFA_CORRUPT/);
    assert.match(verify, /clearMfaEnrollmentForRecovery/);
    const recovery = readSrc('src/app/api/auth/mfa/self-recovery/route.ts');
    assert.match(recovery, /inspectMfaMaterialHealth/);
    assert.match(recovery, /MERLIN_MFA_PASSWORD_RECOVERY/);
  });

  it('login shells expose clear-MFA recovery action', () => {
    const apex = readSrc('src/components/apex/ApexLoginShell.tsx');
    const merlin = readSrc('src/components/LoginView.tsx');
    assert.match(apex, /self-recovery/);
    assert.match(merlin, /self-recovery/);
  });
});
