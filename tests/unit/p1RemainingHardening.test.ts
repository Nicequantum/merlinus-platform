import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  CSRF_COOKIE,
  CSRF_ERROR,
  CSRF_HEADER,
  generateCsrfToken,
  isMutatingHttpMethod,
  validateCsrfRequest,
} from '@/lib/csrf';
import {
  decryptPII,
  encryptPII,
  getDecryptKeyCandidates,
  isDualKeyRotationActive,
  reencryptCiphertextWithCurrentKey,
} from '@/lib/encryption';

const root = resolve(process.cwd());

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('P1-5 dual-key encryption rotation', () => {
  it('encrypt/decrypt roundtrip with current key', () => {
    const sample = `pii-rotate-${Date.now()}`;
    const enc = encryptPII(sample);
    assert.ok(enc.length > 20);
    assert.equal(decryptPII(enc), sample);
  });

  it('getDecryptKeyCandidates includes at least primary', () => {
    const keys = getDecryptKeyCandidates();
    assert.ok(keys.length >= 1);
  });

  it('reencryptCiphertextWithCurrentKey returns ciphertext for encrypted payload', () => {
    const enc = encryptPII('hello-rotation');
    const again = reencryptCiphertextWithCurrentKey(enc);
    assert.ok(again);
    assert.equal(decryptPII(again!), 'hello-rotation');
  });

  it('documents DATA_ENCRYPTION_KEY_PREVIOUS dual-key window', () => {
    assert.match(readSrc('src/lib/encryption.ts'), /DATA_ENCRYPTION_KEY_PREVIOUS/);
    assert.match(readSrc('src/lib/encryption.ts'), /isDualKeyRotationActive/);
    // dual key off when PREVIOUS unset
    assert.equal(isDualKeyRotationActive(), Boolean(process.env.DATA_ENCRYPTION_KEY_PREVIOUS?.trim()));
  });
});

describe('P1-6 CSRF double-submit', () => {
  it('exports cookie/header names and generates tokens', () => {
    assert.equal(CSRF_COOKIE, 'merlin_csrf');
    assert.equal(CSRF_HEADER, 'x-merlin-csrf');
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= 32);
  });

  it('detects mutating methods', () => {
    assert.equal(isMutatingHttpMethod('POST'), true);
    assert.equal(isMutatingHttpMethod('GET'), false);
  });

  it('validateCsrfRequest skips in test runtime', () => {
    const token = generateCsrfToken();
    const req = new Request('https://example.com/api/x', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=${token}`,
        // deliberately omit header — still ok in CI/test
      },
    });
    assert.equal(validateCsrfRequest(req), null);
  });

  it('validateCsrfRequest force-enforce requires matching header', () => {
    const token = generateCsrfToken();
    const bad = new Request('https://example.com/api/x', {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE}=${token}` },
    });
    assert.equal(validateCsrfRequest(bad, { forceEnforce: true }), CSRF_ERROR);

    const good = new Request('https://example.com/api/x', {
      method: 'POST',
      headers: {
        cookie: `${CSRF_COOKIE}=${token}`,
        [CSRF_HEADER]: token,
      },
    });
    assert.equal(validateCsrfRequest(good, { forceEnforce: true }), null);
  });

  it('withAuth and clients wire CSRF', () => {
    assert.match(readSrc('src/lib/apiRoute.ts'), /validateCsrfRequest/);
    assert.match(readSrc('src/lib/api.ts'), /CSRF_HEADER/);
    assert.match(readSrc('src/lib/clientFetchRetry.ts'), /CSRF_HEADER/);
    assert.match(readSrc('src/app/api/auth/login/route.ts'), /applyCsrfCookieToResponse/);
  });
});

describe('P1-3 MFA UI + P1-1 video async', () => {
  it('ForcedMfaEnrollScreen exists and is wired', () => {
    const enroll = readSrc('src/components/ForcedMfaEnrollScreen.tsx');
    assert.match(enroll, /mfa\/(setup|enroll|verify)/);
    assert.match(enroll, /ForcedMfaEnrollScreen/);
    assert.match(readSrc('src/components/BenzTechApp.tsx'), /ForcedMfaEnrollScreen/);
    assert.match(readSrc('src/components/apex/ApexPlatformApp.tsx'), /ForcedMfaEnrollScreen/);
    assert.match(readSrc('src/lib/complianceSession.ts'), /needsMfaEnrollment/);
  });

  it('video generate-report supports async jobs', () => {
    const src = readSrc('src/app/api/video-inspections/[id]/generate-report/route.ts');
    assert.match(src, /wantAsync/);
    assert.match(src, /video\.report/);
    assert.match(src, /runVideoReportGeneration/);
  });
});

describe('P1-7 rooftop smoke integration file', () => {
  it('exists with login → RO → module gate scenarios', () => {
    const src = readSrc('tests/integration/rooftop-smoke.test.ts');
    assert.match(src, /rooftop smoke/i);
    assert.match(src, /postLogin|auth\/login|SESSION_COOKIE/);
    assert.match(src, /MODULE_DISABLED|requireModule|modules/);
  });
});
