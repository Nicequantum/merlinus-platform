import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTenantWhereForTests,
  isRlsTenantModelForTests,
  listDirectDealershipModelsForTests,
  RLS_DENY_DEALERSHIP_ID,
  shouldEnforceRlsForTests,
} from '@/lib/apex/rlsPrismaExtension';
import type { RlsContext } from '@/lib/apex/rlsContext';

describe('F-01 RLS Prisma extension', () => {
  it('covers core PII models with direct dealershipId', () => {
    const models = listDirectDealershipModelsForTests();
    for (const required of [
      'RepairOrder',
      'Technician',
      'AuditLog',
      'ServiceAdvisor',
      'UsageLog',
      'VideoInspection',
    ]) {
      assert.ok(models.includes(required), `expected ${required} in direct dealership models`);
    }
  });

  it('treats RepairLine as relation-scoped tenant model', () => {
    assert.equal(isRlsTenantModelForTests('RepairLine'), true);
    assert.deepEqual(buildTenantWhereForTests('RepairLine', 'd-1'), {
      repairOrder: { dealershipId: 'd-1' },
    });
  });

  it('allows global catalog templates alongside rooftop rows', () => {
    assert.deepEqual(buildTenantWhereForTests('Template', 'd-1'), {
      dealershipId: { in: ['d-1', '__global__'] },
    });
  });

  it('default-denies when no active dealership id', () => {
    assert.deepEqual(buildTenantWhereForTests('RepairOrder', RLS_DENY_DEALERSHIP_ID), {
      dealershipId: RLS_DENY_DEALERSHIP_ID,
    });
  });

  it('enforces only when enforced and not bypass/soft-open', () => {
    const base: RlsContext = {
      technicianId: 't1',
      activeDealershipId: 'd1',
      dealerId: null,
      scopeMode: 'dealership',
    };
    assert.equal(shouldEnforceRlsForTests({ ...base, enforced: true, softOpen: false }), true);
    assert.equal(
      shouldEnforceRlsForTests({ ...base, enforced: true, softOpen: false, bypass: true }),
      false
    );
    assert.equal(shouldEnforceRlsForTests({ ...base, enforced: false, softOpen: true }), false);
  });
});
