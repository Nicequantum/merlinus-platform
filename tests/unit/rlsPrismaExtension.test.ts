import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildFindFirstTenantWhereForTests,
  buildTenantWhereForTests,
  expandCompoundUniqueWhereForTests,
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

  it('documents update/delete rewrite (unique where cannot AND-wrap under RLS)', () => {
    // Regression: video upload/report used update({ where: { id } }) which RLS AND-wrapped
    // → Prisma validation dump (includes updatedAt) → false "RO updated elsewhere" 409.
    const src = readFileSync(resolve(process.cwd(), 'src/lib/apex/rlsPrismaExtension.ts'), 'utf8');
    assert.ok(src.includes("operation === 'update'"));
    assert.ok(src.includes('updateMany'));
    assert.ok(src.includes("operation === 'delete'"));
    assert.ok(src.includes('deleteMany'));
  });

  it('expands compound unique filters for findFirst (DealershipModule)', () => {
    // Regression: findUnique→findFirst with dealershipId_moduleId AND tenant broke Prisma validation.
    // Error was roughly: Unknown arg `dealershipId_moduleId` in where.AND[0].dealershipId_moduleId
    // for findFirst (compound unique is only valid on findUnique/upsert).
    const compound = {
      dealershipId_moduleId: {
        dealershipId: 'd-1',
        moduleId: 'video_mpi',
      },
    };
    const tenant = buildTenantWhereForTests('DealershipModule', 'd-1');
    assert.deepEqual(tenant, { dealershipId: 'd-1' });

    const expanded = expandCompoundUniqueWhereForTests(compound);
    assert.deepEqual(expanded, {
      dealershipId: 'd-1',
      moduleId: 'video_mpi',
    });
    assert.equal(
      Object.prototype.hasOwnProperty.call(expanded, 'dealershipId_moduleId'),
      false
    );

    const findFirstWhere = buildFindFirstTenantWhereForTests(compound, tenant);
    assert.deepEqual(findFirstWhere, {
      dealershipId: 'd-1',
      moduleId: 'video_mpi',
    });
    // Must not nest compound unique under AND (that is what crashed /api/modules).
    assert.equal(Object.prototype.hasOwnProperty.call(findFirstWhere, 'AND'), false);
  });
});
