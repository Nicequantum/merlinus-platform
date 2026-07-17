import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('middleware Clerk integration (Phase 4 PR-4)', () => {
  it('uses clerkMiddleware with createRouteMatcher when Clerk path is enabled', () => {
    const middleware = readSrc('src/middleware.ts');
    assert.ok(middleware.includes('clerkMiddleware'));
    assert.ok(middleware.includes('createRouteMatcher'));
    assert.ok(middleware.includes('isClerkAuthPathEnabled'));
    assert.ok(middleware.includes("signInUrl: '/sign-in'"));
    assert.ok(middleware.includes('MERLIN_PUBLIC_ROUTE_PATTERNS'));
  });

  it('keeps Merlin security middleware layers intact', () => {
    const middleware = readSrc('src/middleware.ts');
    assert.ok(middleware.includes('denyBootstrapSeedInProduction'));
    assert.ok(middleware.includes('denyCrossOriginApi'));
    assert.ok(middleware.includes('applyMerlinSecurityHeaders'));
  });
});