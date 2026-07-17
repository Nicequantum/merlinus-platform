import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  MODULE_CATALOG,
  PRODUCT_MODULE_IDS,
  isProductModuleId,
  parseForcedModules,
} from '../../src/lib/modules/catalog';
import { ModuleDisabledError } from '../../src/lib/modules/entitlements';

describe('PR-M0 product module entitlements', () => {
  test('catalog covers every product module id exactly once', () => {
    const ids = MODULE_CATALOG.map((m) => m.id);
    assert.deepEqual([...ids].sort(), [...PRODUCT_MODULE_IDS].sort());
    assert.equal(new Set(ids).size, ids.length);
  });

  test('core_story is never a product module id', () => {
    assert.equal(isProductModuleId('core_story'), false);
    assert.ok(!PRODUCT_MODULE_IDS.includes('core_story' as (typeof PRODUCT_MODULE_IDS)[number]));
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('enum ModuleId'));
    assert.match(schema, /model DealershipModule/);
    assert.match(schema, /model DealerGroupModule/);
    // Enum body must not list core_story as a ModuleId value
    const enumBlock = schema.match(/enum ModuleId \{[\s\S]*?\}/)?.[0] ?? '';
    assert.ok(enumBlock.includes('video_mpi'));
    assert.ok(!/\bcore_story\b/.test(enumBlock));
  });

  test('parseForcedModules only accepts known product modules', () => {
    const forced = parseForcedModules('video_mpi, parts, core_story, not_real,loaner');
    assert.equal(forced.has('video_mpi'), true);
    assert.equal(forced.has('parts'), true);
    assert.equal(forced.has('loaner'), true);
    assert.equal(forced.size, 3);
  });

  test('parseForcedModules empty / blank', () => {
    assert.equal(parseForcedModules(undefined).size, 0);
    assert.equal(parseForcedModules('').size, 0);
    assert.equal(parseForcedModules('  ,  ').size, 0);
  });

  test('ModuleDisabledError exposes stable code and moduleId', () => {
    const err = new ModuleDisabledError('parts');
    assert.equal(err.name, 'ModuleDisabledError');
    assert.equal(err.code, 'MODULE_DISABLED');
    assert.equal(err.moduleId, 'parts');
    assert.match(err.message, /parts/i);
  });

  test('migration enables RLS on both entitlement tables', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20250721120000_product_module_entitlements/migration.sql'
      ),
      'utf8'
    );
    assert.ok(sql.includes('CREATE TYPE "ModuleId"'));
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "DealershipModule"'));
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS "DealerGroupModule"'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'));
    assert.ok(sql.includes('dealership_module_tenant_all'));
    assert.ok(sql.includes('dealer_group_module_all'));
    // CREATE TYPE list must not include core_story
    const typeBlock = sql.match(/CREATE TYPE "ModuleId" AS ENUM \([\s\S]*?\);/)?.[0] ?? '';
    assert.ok(typeBlock.includes("'video_mpi'"));
    assert.ok(!typeBlock.includes("'core_story'"));
  });

  test('withAuth documents requireModule option', () => {
    const apiRoute = readFileSync(resolve(process.cwd(), 'src/lib/apiRoute.ts'), 'utf8');
    assert.ok(apiRoute.includes('requireModule'));
    assert.ok(apiRoute.includes('MODULE_DISABLED'));
    assert.ok(apiRoute.includes('assertModuleEnabled'));
  });

  test('manager modules API is manager + dealership scoped', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/modules/route.ts'), 'utf8');
    assert.ok(route.includes('requireManager: true'));
    assert.ok(route.includes('requireDealershipContext: true'));
    assert.ok(route.includes('listModuleStatuses'));
    assert.ok(route.includes('coreStoryAlwaysOn'));
  });
});
