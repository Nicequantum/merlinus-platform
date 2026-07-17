import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  aggregateAuthenticatedHealthStatus,
  checkGrokApiConnectivity,
  checkKvStore,
  resolveAuthenticatedHealthHttpStatus,
} from '@/lib/healthChecks';
import { isCiOrTestRuntime, isProductionEnv } from '@/lib/rate-limit';

describe('health CI simulation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.VERCEL_ENV = 'production';
    process.env.CI = 'true';
    process.env.GROK_API_KEY = 'ci-grok-key';
    process.env.SESSION_SECRET = 'ci-test-session-secret-min-32-chars';
    process.env.DATA_ENCRYPTION_KEY =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.SEARCH_HMAC_KEY =
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.NEXT_PUBLIC_GROK_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    mock.restoreAll();
  });

  it('treats NODE_ENV=test as non-production even when VERCEL_ENV=production', () => {
    assert.equal(isCiOrTestRuntime(), true);
    assert.equal(isProductionEnv(), false);
  });

  it('skips live Grok probe outside production and keeps HTTP 200 aggregate', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    assert.equal(isProductionEnv(), false);

    let fetchCalls = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetchCalls += 1;
      return new Response('bad key', { status: 400 });
    });

    const grok = await checkGrokApiConnectivity();
    assert.equal(grok.status, 'ok', 'dev uses config-only Grok check');
    assert.equal(fetchCalls, 0, 'Grok connectivity probe must not call fetch outside production');

    const checks = {
      database: { status: 'ok' as const },
      encryption: { status: 'ok' as const },
      kv: { status: 'warn' as const },
      grokConfig: { status: 'ok' as const },
      grok,
      voice: { status: 'ok' as const },
      maintenance: { status: 'ok' as const },
    };

    assert.equal(aggregateAuthenticatedHealthStatus(checks), 'degraded');
    assert.equal(resolveAuthenticatedHealthHttpStatus(checks), 200);
  });

  it('skips live Grok/KV probes in test/CI and keeps HTTP 200 aggregate', async () => {
    let fetchCalls = 0;
    mock.method(globalThis, 'fetch', async () => {
      fetchCalls += 1;
      return new Response('bad key', { status: 400 });
    });

    const grok = await checkGrokApiConnectivity();
    assert.equal(grok.status, 'ok', 'CI/test uses config-only Grok check');
    assert.equal(fetchCalls, 0, 'Grok connectivity probe must not call fetch in test/CI');

    const kv = await checkKvStore();
    assert.equal(kv.status, 'warn');
    assert.match(kv.detail ?? '', /test\/CI/i);

    const checks = {
      database: { status: 'ok' as const },
      encryption: { status: 'ok' as const },
      kv,
      grokConfig: { status: 'ok' as const },
      grok,
      voice: { status: 'ok' as const },
      maintenance: { status: 'ok' as const },
    };

    assert.equal(aggregateAuthenticatedHealthStatus(checks), 'degraded');
    assert.equal(resolveAuthenticatedHealthHttpStatus(checks), 200);
  });
});