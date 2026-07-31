import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

describe('P0 deploy verification automation', () => {
  it('ships p0-deploy-verify script with live health probes', () => {
    const src = readFileSync(resolve(root, 'scripts/p0-deploy-verify.mjs'), 'utf8');
    assert.match(src, /P0-1/);
    assert.match(src, /getCloudflareContext/);
    assert.match(src, /KV_STORE/);
    assert.match(src, /check:seed-secrets/);
    assert.match(src, /check:rls-registry/);
    assert.match(src, /check:api-routes/);
    assert.match(src, /MERLIN_BASE_URL/);
    assert.match(src, /MERLIN_HEALTH_COOKIE/);
    assert.match(src, /\/api\/health/);
    assert.match(src, /p0-deploy-verify-latest/);
  });

  it('package.json exposes verify:p0', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    assert.ok(pkg.scripts['verify:p0']);
    assert.match(pkg.scripts['verify:p0'], /p0-deploy-verify/);
  });

  it('workersKv still includes OpenNext KV path (P0-1 code gate target)', () => {
    const src = readFileSync(resolve(root, 'src/lib/storage/workersKv.ts'), 'utf8');
    assert.match(src, /getCloudflareContext/);
    assert.match(src, /describeKvBindingSource/);
  });
});
