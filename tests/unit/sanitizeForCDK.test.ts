import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sanitizeForCDK, sanitizeForCDKWithMeta } from '../../src/lib/sanitizeForCDK';

describe('sanitizeForCDK', () => {
  test('strips all CDK-unsafe special characters', () => {
    const input = `Customer's vehicle (VIN: WDD123) showed & "noise" — RPM > 3000 @ 60%!
Path: C:\\shop\\ro_123 [test] {ok} | cost $1,200.50 ~ tilde \`backtick\``;
    const output = sanitizeForCDK(input);
    assert.equal(/[&'"<>/\\~!@#$%^*()_=+[\]{}|;:?`\\]/.test(output), false);
    assert.match(output, /Customer/);
    assert.match(output, /vehicle/);
    assert.match(output, /noise/);
  });

  test('preserves letters, numbers, spaces, period, comma, and hyphen', () => {
    const input = 'Performed test drive. Verified repair, no noise at 60 mph.';
    assert.equal(sanitizeForCDK(input), input);
  });

  test('converts paragraph breaks to period-space', () => {
    const input = 'Complaint confirmed.\n\nCause traced to sensor.\n\nReplaced and verified.';
    assert.equal(
      sanitizeForCDK(input),
      'Complaint confirmed. Cause traced to sensor. Replaced and verified.'
    );
  });

  test('reports wasModified when unsafe characters are removed', () => {
    const { text, wasModified } = sanitizeForCDKWithMeta('Noise @ idle & under load.');
    assert.equal(wasModified, true);
    assert.equal(text, 'Noise idle under load.');
  });

  test('reports wasModified false for already-safe text', () => {
    const input = 'Replaced sensor and verified repair.';
    const { text, wasModified } = sanitizeForCDKWithMeta(input);
    assert.equal(wasModified, false);
    assert.equal(text, input);
  });

  test('handles empty and non-string input', () => {
    assert.equal(sanitizeForCDK(''), '');
    assert.equal(sanitizeForCDKWithMeta('').text, '');
  });
});