import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  APPROVED_API_ROUTE_WRAPPERS,
  INTENTIONAL_BARE_API_ROUTES,
  isIntentionalBareApiRoute,
  routeHasApprovedWrapper,
} from '@/lib/apiRoutePolicy';
import {
  NON_JSON_API_ERROR_MESSAGE,
  parseApiErrorResponse,
  readJsonBodySafe,
} from '@/lib/apiResponseParse';

const root = resolve(process.cwd());

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkRoutes(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}

describe('P0-4 API default-deny policy', () => {
  it('every API route uses an approved wrapper or intentional bare allowlist', () => {
    const routes = walkRoutes(resolve(root, 'src/app/api'));
    assert.ok(routes.length >= 50, `expected many routes, got ${routes.length}`);

    const violations: string[] = [];
    for (const full of routes) {
      const rel = relative(root, full).replace(/\\/g, '/');
      const src = readFileSync(full, 'utf8');
      if (routeHasApprovedWrapper(src)) continue;
      if (isIntentionalBareApiRoute(rel)) continue;
      violations.push(rel);
    }
    assert.deepEqual(violations, [], `unwrapped routes: ${violations.join(', ')}`);
  });

  it('intentional bare allowlist paths exist on disk', () => {
    for (const path of Object.keys(INTENTIONAL_BARE_API_ROUTES)) {
      const full = resolve(root, path);
      assert.ok(statSync(full).isFile(), `missing bare route file: ${path}`);
    }
  });

  it('approved wrappers include withAuth, withPublicRoute, withStoryAiRoute', () => {
    const joined = APPROVED_API_ROUTE_WRAPPERS.join(' ');
    assert.match(joined, /withAuth/);
    assert.match(joined, /withPublicRoute/);
    assert.match(joined, /withStoryAiRoute/);
  });

  it('status and public token routes use withPublicRoute', () => {
    for (const rel of [
      'src/app/api/status/route.ts',
      'src/app/api/public/video/[token]/route.ts',
      'src/app/api/public/video/[token]/media/route.ts',
      'src/app/api/public/hub/appointment/[token]/route.ts',
    ]) {
      const src = readFileSync(resolve(root, rel), 'utf8');
      assert.match(src, /withPublicRoute\(/, rel);
    }
  });

  it('story AI routes use withStoryAiRoute (composes withAuth)', () => {
    for (const name of ['generate-story', 'score-story', 'review-story', 'certify-story']) {
      const rel = `src/app/api/repair-orders/[id]/lines/[lineId]/${name}/route.ts`;
      const src = readFileSync(resolve(root, rel), 'utf8');
      assert.match(src, /withStoryAiRoute\(/, rel);
    }
  });
});

describe('P0-4 client API response parse', () => {
  it('parses JSON error bodies', async () => {
    const res = new Response(JSON.stringify({ error: 'Nope', code: 'X' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await parseApiErrorResponse(res);
    assert.equal(parsed.message, 'Nope');
    assert.equal(parsed.nonJson, false);
    assert.equal(parsed.code, 'X');
  });

  it('maps HTML error pages to friendly non-JSON message', async () => {
    const res = new Response('<!DOCTYPE html><html><body>error</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const parsed = await parseApiErrorResponse(res);
    // Include HTTP status so ops can distinguish edge/storage failures from pure offline.
    assert.match(parsed.message, /Service temporarily unavailable/);
    assert.match(parsed.message, /HTTP 502/);
    assert.equal(parsed.nonJson, true);
    assert.equal(parsed.status, 502);
  });

  it('readJsonBodySafe returns data on success', async () => {
    const res = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    const parsed = await readJsonBodySafe<{ ok: boolean }>(res);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.data.ok, true);
  });

  it('readJsonBodySafe fails closed on HTML success masquerade', async () => {
    const res = new Response('<html>oops</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    const parsed = await readJsonBodySafe(res);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error.nonJson, true);
  });
});
