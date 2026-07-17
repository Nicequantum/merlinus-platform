import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  buildRoNumberSearchQueryTokens,
  buildRoNumberSearchTokens,
  hashRoNumberSearchFragment,
  normalizeRoNumberForSearch,
} from '@/lib/piiSearchToken';

describe('PII search tokens', () => {
  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
    process.env.SEARCH_HMAC_KEY =
      process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';
  });

  test('normalizeRoNumberForSearch uppercases and strips punctuation', () => {
    assert.equal(normalizeRoNumberForSearch(' ro-482910 '), 'RO482910');
  });

  test('buildRoNumberSearchTokens supports contains-style substring matching', () => {
    const tokens = buildRoNumberSearchTokens('482910');
    const queryTokens = buildRoNumberSearchQueryTokens('291');
    assert.ok(tokens.length > 0);
    assert.ok(queryTokens.length > 0);
    assert.ok(queryTokens.every((token) => tokens.includes(token)));
  });

  test('hashRoNumberSearchFragment is stable for identical input', () => {
    const a = hashRoNumberSearchFragment('482910');
    const b = hashRoNumberSearchFragment('482910');
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });
});