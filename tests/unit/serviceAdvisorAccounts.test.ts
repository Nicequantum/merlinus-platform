import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isServiceAdvisorActive } from '@/lib/serviceAdvisorAccounts';

describe('serviceAdvisorAccounts', () => {
  it('isServiceAdvisorActive requires active status and no deletedAt', () => {
    assert.equal(isServiceAdvisorActive({ status: 'active', deletedAt: null }), true);
    assert.equal(isServiceAdvisorActive({ status: 'inactive', deletedAt: null }), false);
    assert.equal(
      isServiceAdvisorActive({ status: 'active', deletedAt: '2026-01-01T00:00:00.000Z' }),
      false
    );
  });
});