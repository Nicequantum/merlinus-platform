import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isTechnicianAccountActive } from '../../src/lib/technicianAccounts';

describe('technicianAccounts', () => {
  test('isTechnicianAccountActive requires active status and no deletedAt', () => {
    assert.equal(isTechnicianAccountActive({ isActive: true, deletedAt: null }), true);
    assert.equal(isTechnicianAccountActive({ isActive: false, deletedAt: null }), false);
    assert.equal(isTechnicianAccountActive({ isActive: true, deletedAt: '2026-06-20T00:00:00.000Z' }), false);
    assert.equal(isTechnicianAccountActive({ isActive: false, deletedAt: '2026-06-20T00:00:00.000Z' }), false);
  });
});