import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  formatRlsRegistryIssues,
  parsePrismaModelsFromSchema,
  validateRlsRegistryAgainstSchema,
} from '@/lib/apex/rlsRegistryValidation';
import {
  buildRegistryTenantWhere,
  DIRECT_DEALERSHIP_MODELS,
  GLOBAL_CATALOG_MODELS,
  isTenantModel,
  listAllRegisteredTenantModels,
  listDirectDealershipModels,
  listRelationScopedModels,
  PLATFORM_NON_TENANT_MODELS,
  RELATION_SCOPED_MODELS,
  RLS_DENY_DEALERSHIP_ID,
} from '@/lib/apex/rlsTenantRegistry';

const root = resolve(process.cwd());

function readSchema(): string {
  return readFileSync(resolve(root, 'prisma/schema.prisma'), 'utf8');
}

describe('P0-5 RLS tenant registry completeness', () => {
  it('registry matches live prisma/schema.prisma (no silent tenant gaps)', () => {
    const result = validateRlsRegistryAgainstSchema(readSchema());
    assert.equal(
      result.ok,
      true,
      formatRlsRegistryIssues(result)
    );
  });

  it('parses all models from schema', () => {
    const models = parsePrismaModelsFromSchema(readSchema());
    assert.ok(models.length >= 40, `expected many models, got ${models.length}`);
    assert.ok(models.some((m) => m.name === 'RepairOrder' && m.hasDealershipId));
    assert.ok(models.some((m) => m.name === 'RepairLine' && !m.hasDealershipId));
    assert.ok(models.some((m) => m.name === 'Dealership' && !m.hasDealershipId));
  });

  it('detects missing DIRECT registration in synthetic schema', () => {
    const schema = `
model EvilTenant {
  id String @id
  dealershipId String
}
model DealerGroup {
  id String @id
}
`;
    const result = validateRlsRegistryAgainstSchema(schema);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'missing_direct' && i.model === 'EvilTenant'));
  });

  it('detects unclassified child model without dealershipId', () => {
    const schema = `
model OrphanChild {
  id String @id
  parentId String
}
model DealerGroup {
  id String @id
}
`;
    const result = validateRlsRegistryAgainstSchema(schema);
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((i) => i.code === 'unclassified_model' && i.model === 'OrphanChild')
    );
  });

  it('core PII models are direct dealership models', () => {
    const direct = listDirectDealershipModels();
    for (const required of [
      'RepairOrder',
      'Technician',
      'AuditLog',
      'ServiceAdvisor',
      'UsageLog',
      'VideoInspection',
      'ServiceAppointment',
      'ConversationInsight',
      'HubAuditEvent',
    ]) {
      assert.ok(direct.includes(required), `missing DIRECT: ${required}`);
    }
  });

  it('relation-scoped children include RepairLine and video findings', () => {
    const rel = listRelationScopedModels();
    assert.ok(rel.includes('RepairLine'));
    assert.ok(rel.includes('VideoInspectionFinding'));
    assert.ok(rel.includes('VoiceTranscriptSegment'));
    assert.equal(isTenantModel('RepairLine'), true);
    assert.deepEqual(buildRegistryTenantWhere('RepairLine', 'd-1'), {
      repairOrder: { dealershipId: 'd-1' },
    });
  });

  it('global catalog models allow __global__ alongside rooftop', () => {
    assert.deepEqual(buildRegistryTenantWhere('Template', 'd-1'), {
      dealershipId: { in: ['d-1', '__global__'] },
    });
    assert.deepEqual(buildRegistryTenantWhere('Template', RLS_DENY_DEALERSHIP_ID), {
      dealershipId: RLS_DENY_DEALERSHIP_ID,
    });
    for (const g of GLOBAL_CATALOG_MODELS) {
      assert.ok(
        (DIRECT_DEALERSHIP_MODELS as readonly string[]).includes(g),
        `${g} must be direct`
      );
    }
  });

  it('platform non-tenant set covers hierarchy and session tokens', () => {
    for (const required of [
      'DealerGroup',
      'Dealer',
      'Dealership',
      'DealerGroupModule',
      'SessionRefreshToken',
    ]) {
      assert.ok(
        (PLATFORM_NON_TENANT_MODELS as readonly string[]).includes(required),
        `missing platform exempt: ${required}`
      );
    }
  });

  it('extension imports registry (no duplicated hard-coded model lists)', () => {
    const ext = readFileSync(resolve(root, 'src/lib/apex/rlsPrismaExtension.ts'), 'utf8');
    assert.match(ext, /rlsTenantRegistry/);
    assert.match(ext, /RELATION_SCOPED_MODELS/);
    // Must not re-list RepairOrder etc as a local Set literal of models
    assert.doesNotMatch(
      ext,
      /const DIRECT_DEALERSHIP_MODELS = new Set\(\[\s*'DealershipModule'/
    );
  });

  it('every registered tenant model is unique and non-empty', () => {
    const all = listAllRegisteredTenantModels();
    assert.equal(all.length, new Set(all).size);
    assert.ok(all.length >= 30);
    assert.ok(Object.keys(RELATION_SCOPED_MODELS).length >= 8);
  });
});
