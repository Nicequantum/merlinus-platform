import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  parseApexAccessClaims,
  parsePendingSelectionClaims,
  parseSessionPayloadClaims,
} from '../../src/lib/sessionClaims';
import { ADVISOR_METRICS_WINDOW_DAYS } from '../../src/lib/advisorMetrics';
import { validateEnvironment } from '../../src/lib/env';

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Phase 7.1 — consistency & scale', () => {
  test('H13 — JWT claim parsers reject malformed payloads', () => {
    assert.equal(parseSessionPayloadClaims(null), null);
    assert.equal(parseSessionPayloadClaims({ technicianId: 'x' }), null);

    const ok = parseSessionPayloadClaims({
      technicianId: 'tech-1',
      name: 'Ada',
      role: 'technician',
      isAdmin: false,
      dealershipId: 'd-1',
      dealershipName: 'Rooftop',
      sessionVersion: 1,
      d7Number: null,
      serviceAdvisorId: null,
      consentAt: null,
      consentVersion: null,
      legalDisclaimerAt: null,
      legalDisclaimerVersion: null,
    });
    assert.ok(ok);
    assert.equal(ok.technicianId, 'tech-1');

    assert.equal(parseApexAccessClaims({ ...ok, tokenType: 'access' }), null);
    const apex = parseApexAccessClaims({
      ...ok,
      tokenType: 'access',
      scopeMode: 'national',
      authSource: 'legacy',
      ipHash: null,
    });
    assert.ok(apex);
    assert.equal(apex.scopeMode, 'national');

    assert.equal(parsePendingSelectionClaims({ tokenType: 'pending_selection' }), null);
    const pending = parsePendingSelectionClaims({
      tokenType: 'pending_selection',
      technicianId: 'tech-1',
      credentialType: 'email',
      sessionVersion: 2,
    });
    assert.ok(pending);
  });

  test('H13 — auth and apexSession use claim parsers (no blind cast)', () => {
    const auth = readSrc('src/lib/auth.ts');
    const apex = readSrc('src/lib/apex/apexSession.ts');
    assert.match(auth, /parseSessionPayloadClaims/);
    assert.doesNotMatch(auth, /as unknown as SessionPayload/);
    assert.match(apex, /parseApexAccessClaims/);
    assert.match(apex, /parsePendingSelectionClaims/);
  });

  test('H6 — production rejects weak or duplicate encryption secrets', () => {
    const saved = {
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
      SEARCH_HMAC_KEY: process.env.SEARCH_HMAC_KEY,
      SESSION_SECRET: process.env.SESSION_SECRET,
      DATABASE_URL: process.env.DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
      GROK_API_KEY: process.env.GROK_API_KEY,
    };

    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost/test';
    process.env.BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || 'blob-token-test';
    process.env.GROK_API_KEY = process.env.GROK_API_KEY || 'xai-test-key';
    process.env.SESSION_SECRET = 'short';
    process.env.DATA_ENCRYPTION_KEY = 'not-hex-and-not-long-enough';
    process.env.SEARCH_HMAC_KEY = 'not-hex-and-not-long-enough';

    const result = validateEnvironment({ throwOnError: false, production: true });
    assert.equal(result.valid, false);
    assert.ok(result.missing.some((m) => m.includes('DATA_ENCRYPTION_KEY') || m.includes('SESSION_SECRET')));

    // Distinct valid 64-hex keys + long session secret should clear quality failures
    const hexA = 'a'.repeat(64);
    const hexB = 'b'.repeat(64);
    process.env.DATA_ENCRYPTION_KEY = hexA;
    process.env.SEARCH_HMAC_KEY = hexA; // duplicate → fail
    process.env.SESSION_SECRET = 's'.repeat(32);
    const dup = validateEnvironment({ throwOnError: false, production: true });
    assert.ok(dup.missing.some((m) => m.includes('SEARCH_HMAC_KEY')));

    process.env.SEARCH_HMAC_KEY = hexB;
    const ok = validateEnvironment({ throwOnError: false, production: true });
    assert.ok(!ok.missing.some((m) => m.includes('DATA_ENCRYPTION_KEY')));
    assert.ok(!ok.missing.some((m) => m.includes('SEARCH_HMAC_KEY') && m.includes('differ')));
    assert.ok(!ok.missing.some((m) => m.includes('SESSION_SECRET')));

    process.env.DATA_ENCRYPTION_KEY = saved.DATA_ENCRYPTION_KEY;
    process.env.SEARCH_HMAC_KEY = saved.SEARCH_HMAC_KEY;
    process.env.SESSION_SECRET = saved.SESSION_SECRET;
    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.BLOB_READ_WRITE_TOKEN = saved.BLOB_READ_WRITE_TOKEN;
    process.env.GROK_API_KEY = saved.GROK_API_KEY;
  });

  test('H2 — advisor metrics use 90-day window and getRlsDb', () => {
    assert.equal(ADVISOR_METRICS_WINDOW_DAYS, 90);
    const src = readSrc('src/lib/advisorMetrics.ts');
    assert.match(src, /getRlsDb/);
    assert.match(src, /updatedAt:\s*\{\s*gte:\s*since/);
    assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/);
  });

  test('H4 — image access batches pathnames (no per-path loop of DB calls)', () => {
    const src = readSrc('src/lib/imageAccess.ts');
    assert.match(src, /loadAttachedPathnames/);
    assert.match(src, /loadRecentUploadPathnames/);
    assert.match(src, /getRlsDb/);
    assert.doesNotMatch(src, /from ['"]\.\/db['"]/);
  });

  test('H5 — owner national session requires platform operator', () => {
    const src = readSrc('src/lib/apex/ownerDealershipContext.ts');
    assert.match(src, /isPlatformOperator/);
    assert.match(src, /buildOwnerHomeSession/);
    assert.match(src, /Otherwise → null/);
  });

  test('H3 — owner summary uses SQL daily buckets', () => {
    const src = readSrc('src/lib/apex/ownerNationalSummary.ts');
    assert.match(src, /loadDailyActivityBuckets/);
    assert.match(src, /\$queryRaw/);
    assert.match(src, /resolveOwnerSummaryDealerScope/);
  });

  test('H1 — tenant routes avoid bare prisma import', () => {
    const paths = [
      'src/app/api/consent/route.ts',
      'src/app/api/legal-disclaimer/route.ts',
      'src/app/api/auth/change-password/route.ts',
      'src/app/api/auth/enter-dealership/route.ts',
      'src/lib/customerPayTemplate.ts',
      'src/lib/imageAccess.ts',
      'src/lib/advisorMetrics.ts',
      'src/lib/auditedAccess.ts',
      'src/lib/audit.ts',
    ];
    for (const p of paths) {
      const src = readSrc(p);
      assert.doesNotMatch(src, /from ['"]@\/lib\/db['"]/, p);
      assert.doesNotMatch(src, /from ['"]\.\/db['"]/, p);
    }
  });
});
