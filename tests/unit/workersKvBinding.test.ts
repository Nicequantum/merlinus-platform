import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('Workers KV binding resolution', () => {
  it('resolves KV_STORE via OpenNext getCloudflareContext like R2', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/storage/workersKv.ts'), 'utf8');
    assert.match(src, /getCloudflareContext/);
    assert.match(src, /__cloudflare-context__/);
    assert.match(src, /cloudflare:workers/);
    assert.match(src, /describeKvBindingSource/);
    assert.match(src, /KV_STORE/);
    assert.match(src, /__CLOUDFLARE_ENV__/);
    assert.match(src, /clampKvExpirationTtl/);
    assert.match(src, /KV_MIN_EXPIRATION_TTL_SEC\s*=\s*60/);
  });

  it('health KV probe uses valid TTL and surfaces operator guidance', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/healthChecks.ts'), 'utf8');
    assert.match(src, /describeKvBindingSource/);
    assert.match(src, /operatorMessage/);
    assert.match(src, /export async function checkMfaPolicyHealth/);
    assert.match(src, /expirationTtl:\s*60/);
    assert.doesNotMatch(src, /expirationTtl:\s*30/);
  });

  it('rate-limit CAS clamps TTL via clampKvExpirationTtl', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
    assert.match(src, /clampKvExpirationTtl/);
  });
});
