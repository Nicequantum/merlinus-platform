import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE,
  BOOTSTRAP_SEED_PATH,
} from '@/lib/bootstrapGuard';
import { isBootstrapSeedAllowed, isProductionRuntime } from '@/lib/productionRuntime';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('bootstrap seed production kill-switch', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it('detects production runtime from NODE_ENV or VERCEL_ENV', () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'preview';
    assert.equal(isProductionRuntime(), true);

    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'production';
    assert.equal(isProductionRuntime(), true);

    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'preview';
    assert.equal(isProductionRuntime(), false);
  });

  it('never allows bootstrap seed in production even when ALLOW_BOOTSTRAP=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_BOOTSTRAP = 'true';
    assert.equal(isBootstrapSeedAllowed(), false);
  });

  it('allows bootstrap seed only outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.VERCEL_ENV = 'development';
    delete process.env.ALLOW_BOOTSTRAP;
    assert.equal(isBootstrapSeedAllowed(), true);
  });

  it('middleware hard-blocks seed path in production', () => {
    const middleware = readSrc('src/middleware.ts');
    const seedRoute = readSrc('src/app/api/setup/seed/route.ts');
    assert.ok(middleware.includes('denyBootstrapSeedInProduction'));
    assert.ok(middleware.includes('BOOTSTRAP_SEED_PATH'));
    assert.equal(BOOTSTRAP_SEED_PATH, '/api/setup/seed');
    assert.ok(readSrc('src/lib/bootstrapGuard.ts').includes('bootstrap.seed.blocked_production'));
    assert.ok(seedRoute.includes('isBootstrapSeedAllowed'));
    assert.ok(seedRoute.includes('BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE'));
    assert.match(BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE, /permanently disabled in production/i);
    assert.equal(seedRoute.includes('ALLOW_BOOTSTRAP'), false);
  });
});