import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getBuildCommit, isMaintenanceModeEnabled, validateEnvironment } from '../../src/lib/env';

describe('environment validation', () => {
  test('detects maintenance mode values', () => {
    const prev = process.env.MERLIN_MAINTENANCE_MODE;
    process.env.MERLIN_MAINTENANCE_MODE = 'true';
    assert.equal(isMaintenanceModeEnabled(), true);
    process.env.MERLIN_MAINTENANCE_MODE = '0';
    assert.equal(isMaintenanceModeEnabled(), false);
    process.env.MERLIN_MAINTENANCE_MODE = prev;
  });

  test('reports missing required variables', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY,
      SEARCH_HMAC_KEY: process.env.SEARCH_HMAC_KEY,
      SESSION_SECRET: process.env.SESSION_SECRET,
    };
    delete process.env.DATABASE_URL;
    const result = validateEnvironment({ throwOnError: false });
    // D1 sole DB: DATABASE_URL is optional (local prisma tooling only).
    assert.equal(result.missing.includes('DATABASE_URL'), false);
    process.env.DATABASE_URL = saved.DATABASE_URL;
    process.env.DATA_ENCRYPTION_KEY = saved.DATA_ENCRYPTION_KEY;
    process.env.SEARCH_HMAC_KEY = saved.SEARCH_HMAC_KEY;
    process.env.SESSION_SECRET = saved.SESSION_SECRET;
  });

  test('fails validation when forbidden NEXT_PUBLIC_GROK_API_KEY is set', () => {
    const saved = process.env.NEXT_PUBLIC_GROK_API_KEY;
    process.env.NEXT_PUBLIC_GROK_API_KEY = 'xai-exposed-key';
    const result = validateEnvironment({ throwOnError: false, production: true });
    assert.ok(result.forbiddenPublicKeys.includes('NEXT_PUBLIC_GROK_API_KEY'));
    assert.equal(result.valid, false);
    if (saved === undefined) delete process.env.NEXT_PUBLIC_GROK_API_KEY;
    else process.env.NEXT_PUBLIC_GROK_API_KEY = saved;
  });

  test('requires GROK_API_KEY in production; photo storage is R2 APEX_R2 not Blob token', () => {
    const saved = {
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
      GROK_API_KEY: process.env.GROK_API_KEY,
    };
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.GROK_API_KEY;

    const prod = validateEnvironment({ throwOnError: false, production: true });
    // Workers use R2 binding APEX_R2 — legacy BLOB_READ_WRITE_TOKEN is optional, not hard-missing.
    assert.equal(prod.missing.includes('BLOB_READ_WRITE_TOKEN'), false);
    assert.ok(prod.missing.includes('GROK_API_KEY'));
    assert.ok(
      prod.warnings.some((w) => w.includes('APEX_R2') || w.includes('R2')),
      'production without Blob token should warn to confirm Worker R2 binding'
    );

    const dev = validateEnvironment({ throwOnError: false, production: false });
    assert.ok(dev.warnings.some((w) => w.includes('GROK_API_KEY')));

    if (saved.BLOB_READ_WRITE_TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved.BLOB_READ_WRITE_TOKEN;
    if (saved.GROK_API_KEY === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = saved.GROK_API_KEY;
  });

  test('getBuildCommit falls back to dev', () => {
    const prev = process.env.NEXT_PUBLIC_BUILD_COMMIT;
    delete process.env.NEXT_PUBLIC_BUILD_COMMIT;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT;
    assert.equal(getBuildCommit(), 'dev');
    process.env.NEXT_PUBLIC_BUILD_COMMIT = prev;
  });
});