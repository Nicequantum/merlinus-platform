import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildOtpAuthUriClient,
  generateTotpSecretClient,
} from '@/lib/mfa/totpClient';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Settings security polish — rotation UI + in-app MFA', () => {
  it('rotation panel has generate, submit field, and progress', () => {
    const panel = readSrc('src/components/EncryptionRotationPanel.tsx');
    assert.match(panel, /Generate new key/);
    assert.match(panel, /Enter newly rotated key/i);
    assert.match(panel, /Submit New Key/);
    assert.match(panel, /confirmEncryptionEnvKey/);
    assert.match(panel, /progressPercent/);
    assert.match(panel, /fingerprint/i);
  });

  it('rotation API supports confirm-env', () => {
    const route = readSrc('src/app/api/manager/encryption/rotate/route.ts');
    const svc = readSrc('src/lib/encryption/rotationService.ts');
    assert.match(route, /confirm-env/);
    assert.match(svc, /confirmEncryptionEnvKey/);
    assert.match(svc, /encryption\.rotation_env_confirmed/);
  });

  it('client TOTP helpers generate secret and otpauth URI', () => {
    const secret = generateTotpSecretClient();
    assert.ok(secret.length >= 16);
    assert.match(secret, /^[A-Z2-7]+$/);
    const uri = buildOtpAuthUriClient({
      secret,
      accountName: 'D7TEST',
      issuer: 'Merlinus',
    });
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.ok(uri.includes(secret));
  });

  it('MFA panels use in-app enrollment client', () => {
    const settings = readSrc('src/components/MfaSettingsPanel.tsx');
    const forced = readSrc('src/components/ForcedMfaEnrollScreen.tsx');
    const verify = readSrc('src/app/api/auth/mfa/verify/route.ts');
    const service = readSrc('src/lib/mfa/service.ts');
    assert.match(settings, /beginInAppMfaEnrollment/);
    assert.match(settings, /mfaVerifyEnroll\(code\.trim\(\), secret\)/);
    assert.match(forced, /beginInAppMfaEnrollment/);
    assert.match(verify, /secret/);
    assert.match(service, /clientSecret|input\.secret/);
  });

  it('Settings groups Security section for MFA + rotation', () => {
    const settings = readSrc('src/components/SettingsView.tsx');
    assert.match(settings, /Security/);
    assert.match(settings, /MfaSettingsPanel/);
    assert.match(settings, /EncryptionRotationPanel/);
  });
});
