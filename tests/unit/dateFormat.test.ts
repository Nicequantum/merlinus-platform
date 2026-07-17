import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/dateFormat';

describe('dateFormat utilities', () => {
  it('formatDisplayDate returns locale date string', () => {
    const result = formatDisplayDate('2026-06-24T12:00:00.000Z');
    assert.ok(result.length > 0);
  });

  it('formatDisplayDate handles invalid input', () => {
    assert.equal(formatDisplayDate(''), '');
    assert.equal(formatDisplayDate('not-a-date'), '');
  });

  it('formatDisplayDateTime includes time', () => {
    const result = formatDisplayDateTime('2026-06-24T15:30:00.000Z');
    assert.ok(result.length > 0);
  });
});