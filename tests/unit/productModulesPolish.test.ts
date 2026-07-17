import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  DEFERRED_MODULE_IDS,
  SEED_ENABLED_MODULE_IDS,
} from '../../src/lib/modules/catalog';

describe('Product modules polish pass', () => {
  test('shared ModuleDisabledNotice exists and is used by dashboards', () => {
    const notice = readFileSync(
      resolve(process.cwd(), 'src/components/modules/ModuleDisabledNotice.tsx'),
      'utf8'
    );
    assert.ok(notice.includes('Manager Dashboard → Modules'));

    for (const file of [
      'src/components/department/DepartmentRequestDashboard.tsx',
      'src/components/loaner/LoanerDashboard.tsx',
      'src/components/maintenance/MaintenanceDashboard.tsx',
      'src/components/voice/VoiceOpsDashboard.tsx',
      'src/components/videoInspection/VideoInspectionView.tsx',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes('ModuleDisabledNotice'), file);
    }
  });

  test('entitlements export set + ensure helpers', () => {
    const ent = readFileSync(resolve(process.cwd(), 'src/lib/modules/entitlements.ts'), 'utf8');
    assert.ok(ent.includes('export async function setDealershipModuleEnabled'));
    assert.ok(ent.includes('export async function ensureDealershipModuleDefaults'));
    assert.ok(ent.includes('export async function ensureAllDealershipModuleDefaults'));
    // Never invent core_story rows
    assert.ok(!ent.includes("moduleId: 'core_story'"));
  });

  test('audit action module.set is defined as critical', () => {
    const audit = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
    assert.ok(audit.includes("| 'module.set'"));
    assert.ok(audit.includes("'module.set'"));
  });

  test('seed list and deferred list are disjoint', () => {
    for (const id of DEFERRED_MODULE_IDS) {
      assert.ok(!SEED_ENABLED_MODULE_IDS.includes(id), id);
    }
  });
});
