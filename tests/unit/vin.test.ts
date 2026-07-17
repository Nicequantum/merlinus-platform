import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeDecodedModel } from '../../src/lib/vin';

describe('vin normalization', () => {
  test('normalizeDecodedModel converts NHTSA *-Class to series token', () => {
    assert.equal(normalizeDecodedModel('GLA-Class', 'GLA250 4MATIC'), 'GLA250');
    assert.equal(normalizeDecodedModel('GLE-Class', ''), 'GLE');
    assert.equal(normalizeDecodedModel('C-Class', 'C300 4MATIC'), 'C300');
  });

  test('normalizeDecodedModel derives model from trim when model is empty', () => {
    assert.equal(normalizeDecodedModel('', 'E350 4MATIC'), 'E350');
    assert.equal(normalizeDecodedModel('', 'GLE450 4MATIC'), 'GLE');
  });

  test('normalizeDecodedModel passes through explicit model strings', () => {
    assert.equal(normalizeDecodedModel('GLE 450', ''), 'GLE 450');
  });
});