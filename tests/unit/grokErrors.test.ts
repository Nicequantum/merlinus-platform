import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapGrokRouteError } from '../../src/lib/grokErrors';

describe('grok route error mapping', () => {
  test('maps missing API key to 503', () => {
    const mapped = mapGrokRouteError(new Error('GROK_API_KEY not configured'), 'Story generation');
    assert.equal(mapped.status, 503);
    assert.match(mapped.message, /unavailable/i);
  });

  test('maps timeout to 504', () => {
    const mapped = mapGrokRouteError(new Error('Grok API timed out after 110s'), 'Story generation');
    assert.equal(mapped.status, 504);
  });

  test('maps generic failures to 502', () => {
    const mapped = mapGrokRouteError(new Error('unexpected'), 'Story review');
    assert.equal(mapped.status, 502);
  });
});