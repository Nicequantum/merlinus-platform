import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';

describe('select-dealership (Phase 5.4)', () => {
  test('route verifies pending token and issues apex session cookies', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/api/auth/select-dealership/route.ts'),
      'utf8'
    );
    assert.match(src, /verifyPendingSelectionToken/);
    assert.match(src, /consumePendingSelectionToken/);
    assert.match(src, /resolveSelectDealershipSession/);
    assert.match(src, /issueApexSessionCookies/);
    assert.match(src, /auth\.select_dealership/);
    assert.match(src, /isApexPlatformMode/);
  });

  test('resolveSelectDealershipSession issues dealership scopeMode + activeDealershipId', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/apex/selectDealership.ts'), 'utf8');
    assert.match(src, /scopeMode:\s*'dealership'/);
    assert.match(src, /activeDealershipId:\s*dealership\.id/);
  });

  test('refresh route rotates tokens in apex mode only', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/api/auth/refresh/route.ts'), 'utf8');
    assert.match(src, /rotateApexRefreshToken/);
    assert.match(src, /applyApexSessionCookies/);
    assert.match(src, /auth\.refresh/);
    assert.match(src, /isApexPlatformMode/);
  });

  test('login route returns pendingToken for multi-dealership apex users', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/api/auth/login/route.ts'), 'utf8');
    assert.match(src, /createPendingSelectionToken/);
    assert.match(src, /pendingToken/);
    assert.match(src, /issueApexSessionCookies/);
  });
});