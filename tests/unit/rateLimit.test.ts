import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkRateLimit,
  isKvConfigured,
  RATE_LIMITS,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
} from '@/lib/rate-limit';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function makeRequest(ip = '203.0.113.10', origin = 'http://localhost'): Request {
  return new Request(`${origin}/api/test`, {
    headers: { 'x-real-ip': ip },
  });
}

function saveRateLimitEnv() {
  return {
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
    vercel: process.env.VERCEL,
    ci: process.env.CI,
    githubActions: process.env.GITHUB_ACTIONS,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
    platformMode: process.env.PLATFORM_MODE,
    publicPlatformMode: process.env.NEXT_PUBLIC_PLATFORM_MODE,
  };
}

function restoreRateLimitEnv(saved: ReturnType<typeof saveRateLimitEnv>): void {
  process.env.NODE_ENV = saved.nodeEnv;
  process.env.VERCEL_ENV = saved.vercelEnv;
  if (saved.vercel === undefined) {
    delete process.env.VERCEL;
  } else {
    process.env.VERCEL = saved.vercel;
  }
  if (saved.ci === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = saved.ci;
  }
  if (saved.githubActions === undefined) {
    delete process.env.GITHUB_ACTIONS;
  } else {
    process.env.GITHUB_ACTIONS = saved.githubActions;
  }
  process.env.KV_REST_API_URL = saved.kvUrl;
  process.env.KV_REST_API_TOKEN = saved.kvToken;
  if (saved.platformMode === undefined) delete process.env.PLATFORM_MODE;
  else process.env.PLATFORM_MODE = saved.platformMode;
  if (saved.publicPlatformMode === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
  else process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.publicPlatformMode;
}

function setVercelProductionEnv(opts?: { apex?: boolean }): void {
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
  // Phase 7.1 — Merlinus memory-fallback tests must not run under Apex fail-closed
  if (opts?.apex) {
    process.env.PLATFORM_MODE = 'apex';
    process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
  } else {
    process.env.PLATFORM_MODE = 'merlinus';
    process.env.NEXT_PUBLIC_PLATFORM_MODE = 'merlinus';
  }
}

describe('rate limiting', () => {
  it('documents limits and KV memory fallback behavior in source', () => {
    const src = readSrc('src/lib/rate-limit.ts');
    assert.ok(src.includes('RATE_LIMIT_UNAVAILABLE_MESSAGE'));
    assert.ok(src.includes('rate_limit.kv_fallback_memory'));
    assert.ok(src.includes('rate_limit.check'));
    assert.ok(src.includes('isLocalhostRequest'));
    assert.ok(src.includes('memoryRateLimitConfig'));
    assert.equal(src.includes('FAIL_CLOSED_ROUTE_KEYS'), false);
    assert.equal(src.includes('NEVER_FAIL_CLOSED_ROUTE_KEYS'), false);
    assert.equal(src.includes('fail_closed_kv_unavailable'), false);
    assert.equal(src.includes('rate_limit.kv_unavailable'), false);
    assert.equal(src.includes("logger.warn('rate_limit.kv_fallback'"), false);
    assert.ok(src.includes('Distributed per-IP rate limiting'));
    assert.ok(RATE_LIMITS.auth.limit === 10);
    assert.ok(RATE_LIMITS.generate.limit === 20);
    assert.ok(RATE_LIMITS.upload.limit === 30);
    assert.ok(RATE_LIMITS.default.limit === 60);
    assert.ok(RATE_LIMIT_UNAVAILABLE_MESSAGE.length > 0);
  });

  it('allows dev traffic without KV using in-memory limits', async () => {
    const saved = saveRateLimitEnv();
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    try {
      assert.equal(isKvConfigured(), false);
      const routeKey = `test.dev.${Date.now()}`;
      const result = await checkRateLimit(makeRequest(), routeKey, RATE_LIMITS.default);
      assert.equal(result, null);
    } finally {
      restoreRateLimitEnv(saved);
    }
  });

  it('allows local production start without KV using in-memory limits', async () => {
    const saved = saveRateLimitEnv();
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL_ENV;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    try {
      const routeKey = `test.local.prod.${Date.now()}`;
      const result = await checkRateLimit(makeRequest(), routeKey, RATE_LIMITS.auth);
      assert.equal(result, null);
    } finally {
      restoreRateLimitEnv(saved);
    }
  });

  it('allows local env with VERCEL_ENV=production when KV is unreachable', async () => {
    const saved = saveRateLimitEnv();
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    delete process.env.VERCEL;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'invalid-token';

    try {
      const routeKey = `test.pulled.env.${Date.now()}`;
      const result = await checkRateLimit(makeRequest(), routeKey, RATE_LIMITS.auth);
      assert.equal(result, null);
    } finally {
      restoreRateLimitEnv(saved);
    }
  });

  it('allows localhost traffic on Vercel production runtime without KV', async () => {
    const saved = saveRateLimitEnv();
    setVercelProductionEnv();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    try {
      const routeKey = `test.localhost.vercel.${Date.now()}`;
      const result = await checkRateLimit(makeRequest(), routeKey, RATE_LIMITS.auth);
      assert.equal(result, null);
    } finally {
      restoreRateLimitEnv(saved);
    }
  });

  it('allows all app routes on Vercel production without KV using in-memory limits', async () => {
    const saved = saveRateLimitEnv();
    setVercelProductionEnv();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    try {
      for (const routeKey of [
        'auth.login',
        'auth.me',
        'legal_disclaimer',
        'dashboard.summary',
        'ros.list',
        'technician_logs.ingest',
        'consent',
        'companion.stream',
        'companion.publish',
        'story.generate',
        'upload',
      ]) {
        const result = await checkRateLimit(
          makeRequest('203.0.113.10', 'https://merlinus.vercel.app'),
          routeKey,
          RATE_LIMITS.default
        );
        assert.equal(result, null, `expected ${routeKey} to use in-memory fallback`);
      }
    } finally {
      restoreRateLimitEnv(saved);
    }
  });

  it('falls back to memory for all routes on Vercel production when KV is unreachable', async () => {
    const saved = saveRateLimitEnv();
    setVercelProductionEnv();
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'invalid-token';

    try {
      for (const routeKey of [
        'dashboard.summary',
        'ros.list',
        'legal_disclaimer',
        'auth.login',
        'story.generate',
        'ro.extract',
        'upload',
        'companion.stream',
      ]) {
        const result = await checkRateLimit(
          makeRequest('203.0.113.10', 'https://merlinus.vercel.app'),
          routeKey,
          RATE_LIMITS.default
        );
        assert.equal(result, null, `expected ${routeKey} to fall back to memory`);
      }
    } finally {
      restoreRateLimitEnv(saved);
    }
  });
});