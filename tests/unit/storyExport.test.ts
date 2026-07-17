import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeWarrantyStoryText } from '../../src/utils/pdfExport';

describe('warranty story export formatting', () => {
  test('normalizes line endings and collapses excessive blank lines', () => {
    const input = 'First paragraph.\r\n\r\n\r\n\r\nSecond paragraph.';
    assert.equal(normalizeWarrantyStoryText(input), 'First paragraph.\n\nSecond paragraph.');
  });

  test('strips zero-width and control characters', () => {
    const input = 'Customer\u200B states\uFEFF noise.\u0007';
    assert.equal(normalizeWarrantyStoryText(input), 'Customer states noise.');
  });

  test('collapses irregular whitespace within lines', () => {
    const input = 'Performed   test    drive   and   verified   repair.';
    assert.equal(normalizeWarrantyStoryText(input), 'Performed test drive and verified repair.');
  });

  test('preserves intentional paragraph breaks', () => {
    const input = 'Complaint confirmed on road test.\n\nCause traced to faulty sensor.\n\nReplaced sensor and verified.';
    assert.equal(
      normalizeWarrantyStoryText(input),
      'Complaint confirmed on road test.\n\nCause traced to faulty sensor.\n\nReplaced sensor and verified.'
    );
  });
});