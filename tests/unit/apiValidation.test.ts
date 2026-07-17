import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseQueryParams,
  parseRouteParams,
  repairOrderListQuerySchema,
  routeIdParamsSchema,
} from '@/lib/validation';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('API input validation', () => {
  it('login uses bounded JSON parsing', () => {
    const src = readSrc('src/app/api/auth/login/route.ts');
    const validation = readSrc('src/lib/validation.ts');
    assert.ok(src.includes('parseRequestBody'));
    assert.ok(src.includes('AUTH_JSON_BODY_LIMIT_BYTES'));
    assert.equal(src.includes('request.json()'), false);
    assert.ok(validation.includes('AUTH_JSON_BODY_LIMIT_BYTES = 16_384'));
  });

  it('parseQueryParams rejects invalid repair order list queries', () => {
    const request = new Request('http://localhost/api/repair-orders?scope=invalid&limit=999');
    const parsed = parseQueryParams(request, repairOrderListQuerySchema);
    assert.ok('error' in parsed);
  });

  it('parseRouteParams rejects malformed entity ids', async () => {
    const parsed = await parseRouteParams(routeIdParamsSchema, Promise.resolve({ id: '' }));
    assert.ok('error' in parsed);
  });

  it('major GET routes use shared query schemas', () => {
    assert.ok(readSrc('src/app/api/images/route.ts').includes('imagePathnameQuerySchema'));
    assert.ok(readSrc('src/app/api/templates/route.ts').includes('templateListQuerySchema'));
    assert.ok(readSrc('src/app/api/knowledge-base/route.ts').includes('knowledgeBaseListQuerySchema'));
    assert.ok(readSrc('src/app/api/audit-logs/latest/route.ts').includes('auditLatestQuerySchema'));
  });

  it('dynamic repair-order line routes validate path params', () => {
    const lineRoutes = [
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/certify-story/route.ts',
      'src/app/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay/route.ts',
    ];
    const shell = readSrc('src/lib/storyAiRoute.ts');
    for (const route of lineRoutes) {
      const src = readSrc(route);
      // Phase 7.3 — story routes validate params via withStoryAiRoute shell
      assert.ok(
        src.includes('repairOrderLineParamsSchema') ||
          src.includes('withStoryAiRoute') ||
          shell.includes('repairOrderLineParamsSchema'),
        route
      );
      assert.ok(
        src.includes('parseRouteParams') || src.includes('withStoryAiRoute'),
        route
      );
    }
  });
});