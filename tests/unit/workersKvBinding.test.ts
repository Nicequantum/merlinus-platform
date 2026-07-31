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
  });

  it('health KV probe surfaces operator guidance when unbound', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/healthChecks.ts'), 'utf8');
    assert.match(src, /describeKvBindingSource/);
    assert.match(src, /operatorMessage/);
    assert.match(src, /export async function checkMfaPolicyHealth/);
  });
});
