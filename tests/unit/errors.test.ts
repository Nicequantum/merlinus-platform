import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { handleRouteError } from '@/lib/errors';

const root = resolve(process.cwd());

describe('route error handling', () => {
  it('handleRouteError uses unified mapper and reports to Sentry', async () => {
    const src = readFileSync(resolve(root, 'src/lib/errors.ts'), 'utf8');
    assert.ok(src.includes('Sentry.captureException'));
    assert.ok(src.includes('mapRouteError'));

    const response = handleRouteError(new Error('database connection refused'), 'ros.update');
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /Database is temporarily unavailable/i);
  });
});