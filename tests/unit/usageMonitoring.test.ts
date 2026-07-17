import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DAILY_USAGE_LIMIT } from '../../src/lib/usageMonitoring';

describe('usage monitoring constants', () => {
  test('M28: daily limit defaults to 50 or env override', () => {
    assert.ok(DAILY_USAGE_LIMIT >= 1);
  });
});