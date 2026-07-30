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
  it('rotation panel is one-click in-app with progress (no env paste flow)', () => {
    const panel = readSrc('src/components/EncryptionRotationPanel.tsx');
    assert.match(panel, /Rotate keys now/);
    assert.match(panel, /rotateEncryptionKeysInApp/);
    assert.match(panel, /progressPercent/);
    assert.match(panel, /fingerprint/i);
    assert.match(panel, /Resume re-encrypt/);
    assert.match(panel, /90 days/i);
    // Legacy env-paste flow removed from UI
    assert.doesNotMatch(panel, /Generate new key/);
    assert.doesNotMatch(panel, /Enter newly rotated key/i);
  });

  it('rotation API supports confirm-env (legacy) and rotate-in-app', () => {
    const route = readSrc('src/app/api/manager/encryption/rotate/route.ts');
    const svc = readSrc('src/lib/encryption/rotationService.ts');
    assert.match(route, /confirm-env/);
    assert.match(route, /rotate-in-app/);
    assert.match(svc, /confirmEncryptionEnvKey/);
    assert.match(svc, /rotateEncryptionKeysInApp/);
    assert.match(svc, /tickReencryptRotationJob/);
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
