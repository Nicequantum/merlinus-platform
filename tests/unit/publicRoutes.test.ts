import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isMerlinPublicPath, MERLIN_PUBLIC_ROUTE_PATTERNS } from '../../src/lib/publicRoutes';

describe('public routes (Phase 4 PR-4)', () => {
  test('MERLIN_PUBLIC_ROUTE_PATTERNS includes auth and webhook paths', () => {
    const patterns = [...MERLIN_PUBLIC_ROUTE_PATTERNS];
    assert.ok(patterns.includes('/api/auth/login'));
    assert.ok(patterns.includes('/api/webhooks/clerk'));
    assert.ok(patterns.includes('/sign-in(.*)'));
  });

  test('isMerlinPublicPath recognizes sign-in catch-all routes', () => {
    assert.equal(isMerlinPublicPath('/sign-in'), true);
    assert.equal(isMerlinPublicPath('/sign-in/factor-one'), true);
    assert.equal(isMerlinPublicPath('/api/repair-orders'), false);
  });
});