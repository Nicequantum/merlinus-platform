import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { internalEmailForD7, isValidD7Number, normalizeD7Number } from '../../src/lib/d7Number';

describe('D7 number helpers', () => {
  test('normalizes casing and whitespace', () => {
    assert.equal(normalizeD7Number(' d7harrih '), 'D7HARRIH');
  });

  test('accepts valid Mercedes D7 identifiers', () => {
    assert.ok(isValidD7Number('D7HARRIH'));
    assert.ok(isValidD7Number('D7TECH001'));
  });

  test('rejects values without D7 prefix', () => {
    assert.ok(!isValidD7Number('HARRIH'));
    assert.ok(!isValidD7Number('admin@dealership.com'));
  });

  test('builds internal email from D7 number', () => {
    assert.equal(internalEmailForD7('D7HARRIH'), 'd7harrih@benz-tech.local');
  });
});