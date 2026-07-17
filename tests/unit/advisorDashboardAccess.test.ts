import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isServiceAdvisorUser } from '@/lib/advisorDashboardAccess';

describe('advisorDashboardAccess', () => {
  it('detects service advisor users', () => {
    assert.equal(isServiceAdvisorUser({ role: 'service_advisor' }), true);
    assert.equal(isServiceAdvisorUser({ role: 'technician' }), false);
    assert.equal(isServiceAdvisorUser({ role: 'manager' }), false);
  });
});