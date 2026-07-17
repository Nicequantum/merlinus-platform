import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createRepairOrderSchema, parseBody } from '../../src/lib/validation';

describe('complaint validation', () => {
  test('keeps blank complaint slots during RO create/update parsing', () => {
    const parsed = parseBody(createRepairOrderSchema, {
      roNumber: 'RO-TEST',
      complaints: ['Existing concern', ''],
      complaintLabels: ['A', 'B'],
    });

    assert.ok(!('error' in parsed), parsed && 'error' in parsed ? parsed.error : '');
    if ('error' in parsed) return;

    assert.deepEqual(parsed.data.complaints, ['Existing concern', '']);
    assert.deepEqual(parsed.data.complaintLabels, ['A', 'B']);
  });
});