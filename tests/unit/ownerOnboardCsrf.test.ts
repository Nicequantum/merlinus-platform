import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

describe('Owner onboard CSRF', () => {
  it('provision POST seeds CSRF then sends double-submit header', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/apex/OwnerOnboardDealershipForm.tsx'),
      'utf8'
    );
    assert.match(src, /ensureCsrfToken/);
    assert.match(src, /withCsrfHeaders/);
    assert.match(src, /\/api\/owner\/provision-dealer/);
    assert.match(src, /csrfToken/);
  });

  it('csrf seed route exists and is intentional bare', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/auth/csrf/route.ts'), 'utf8');
    const policy = readFileSync(resolve(process.cwd(), 'src/lib/apiRoutePolicy.ts'), 'utf8');
    assert.match(route, /applyCsrfCookieToResponse/);
    assert.match(route, /generateCsrfToken|readCsrfTokenFromRequest/);
    assert.match(policy, /auth\/csrf\/route\.ts/);
  });

  it('client ensureCsrfToken seeds /api/auth/csrf', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/csrfClient.ts'), 'utf8');
    assert.match(src, /export async function ensureCsrfToken/);
    assert.match(src, /\/api\/auth\/csrf/);
    assert.match(src, /writeCsrfCookieClient/);
  });
});
