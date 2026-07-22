import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  aggregateAuthenticatedHealthStatus,
  aggregateHealthStatus,
  buildHealthServicesPayload,
  resolveAuthenticatedHealthHttpStatus,
  toHealthServiceStatus,
} from '@/lib/healthChecks';
import { isProductionEnv } from '@/lib/rate-limit';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('enterprise health checks', () => {
  it('aggregates error over warn over ok', () => {
    assert.equal(
      aggregateHealthStatus({
        database: { status: 'ok' },
        kv: { status: 'warn' },
      }),
      'degraded'
    );
    assert.equal(
      aggregateHealthStatus({
        database: { status: 'ok' },
        encryption: { status: 'error' },
      }),
      'error'
    );
  });

  it('authenticated health returns 503 only for critical failures', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalVercel = process.env.VERCEL;
    process.env.NODE_ENV = 'test';
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL;

    const ciLikeChecks = {
      database: { status: 'ok' as const },
      encryption: { status: 'ok' as const },
      kv: { status: 'warn' as const },
      grokConfig: { status: 'ok' as const },
      grok: { status: 'warn' as const },
      voice: { status: 'ok' as const },
      maintenance: { status: 'ok' as const },
    };

    assert.equal(aggregateAuthenticatedHealthStatus(ciLikeChecks), 'degraded');
    assert.equal(resolveAuthenticatedHealthHttpStatus(ciLikeChecks), 200);

    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'error' },
        grok: { status: 'warn' },
      }),
      'error'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'error' },
        grok: { status: 'warn' },
      }),
      503
    );
    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'ok' },
        encryption: { status: 'error' },
        grok: { status: 'warn' },
      }),
      'degraded'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'ok' },
        encryption: { status: 'error' },
        grok: { status: 'warn' },
      }),
      200
    );

    process.env.VERCEL_ENV = 'production';
    assert.equal(isProductionEnv(), false, 'NODE_ENV=test must not be treated as production');
    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      'degraded'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      200
    );

    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL_ENV;
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    assert.equal(
      isProductionEnv(),
      false,
      'local next start (NODE_ENV=production without VERCEL_ENV) must not be treated as production'
    );
    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      'degraded'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      200
    );

    process.env.VERCEL = '1';
    process.env.VERCEL_ENV = 'production';
    assert.equal(isProductionEnv(), true);
    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      'error'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'ok' },
        kv: { status: 'error' },
        grok: { status: 'warn' },
      }),
      503
    );

    // P0: owner seed password secrets remaining on production Worker → 503
    assert.equal(
      aggregateAuthenticatedHealthStatus({
        database: { status: 'ok' },
        kv: { status: 'ok' },
        ownerSeedSecrets: { status: 'error' },
      }),
      'error'
    );
    assert.equal(
      resolveAuthenticatedHealthHttpStatus({
        database: { status: 'ok' },
        kv: { status: 'ok' },
        ownerSeedSecrets: { status: 'error' },
      }),
      503
    );

    process.env.NODE_ENV = originalNodeEnv;
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
  });

  it('builds monitoring payload without internal detail strings', () => {
    const payload = buildHealthServicesPayload({
      database: { status: 'ok', latencyMs: 12, detail: 'secret diagnostics' },
      grok: { status: 'warn', detail: 'skipped' },
    });
    assert.deepEqual(payload.database, { status: 'ok', latencyMs: 12 });
    assert.deepEqual(payload.grok, { status: 'warn' });
    assert.equal(JSON.stringify(payload).includes('secret diagnostics'), false);
  });

  it('toHealthServiceStatus omits latency when absent', () => {
    assert.deepEqual(toHealthServiceStatus({ status: 'ok' }), { status: 'ok' });
  });

  it('health route probes critical services with Grok connectivity', () => {
    const route = readSrc('src/app/api/health/route.ts');
    const checks = readSrc('src/lib/healthChecks.ts');
    assert.ok(route.includes('buildHealthServicesPayload'));
    assert.ok(route.includes('logUnhealthyServices'));
    assert.ok(route.includes('resolveAuthenticatedHealthHttpStatus'));
    assert.ok(route.includes('resolveModuleHealthSummary'));
    assert.ok(route.includes('modulesEnabled'));
    assert.ok(checks.includes('checkTwilioVoiceConfig'));
    assert.ok(checks.includes('checkTwilioSmsConfig'));
    assert.ok(checks.includes('objectStorage'));
    assert.ok(checks.includes('checkGrokApiConnectivity'));
    assert.ok(checks.includes('checkDatabase'));
    assert.ok(checks.includes('checkKvStore'));
    assert.ok(checks.includes('checkEncryption'));
    assert.ok(checks.includes('GROK_MODELS_URL'));
    assert.equal(checks.includes('chat/completions'), false);
    assert.ok(checks.includes('checkAiJobsQueueHealth'));
    assert.ok(checks.includes('errorRate24h') || checks.includes('oldestQueued'));
  });
});