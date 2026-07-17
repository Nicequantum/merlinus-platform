import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  canAccessDepartmentInbox,
  INBOX_DEPARTMENT_IDS,
  isInboxDepartmentId,
  moduleForDepartment,
} from '../../src/lib/department/constants';
import { MODULE_CATALOG, PRODUCT_MODULE_IDS } from '../../src/lib/modules/catalog';

describe('PR-M8 Sales / Service department inboxes', () => {
  test('inbox departments map to product modules', () => {
    assert.deepEqual([...INBOX_DEPARTMENT_IDS], ['parts', 'sales', 'service']);
    assert.equal(moduleForDepartment('parts'), 'parts');
    assert.equal(moduleForDepartment('sales'), 'sales');
    assert.equal(moduleForDepartment('service'), 'service');
    assert.equal(moduleForDepartment('loaner'), null);
    assert.equal(moduleForDepartment('maintenance'), null);
    assert.equal(isInboxDepartmentId('sales'), true);
    assert.equal(isInboxDepartmentId('loaner'), false);
  });

  test('role access: sales/service staff + manager/owner only', () => {
    assert.equal(canAccessDepartmentInbox('sales', 'sales'), true);
    assert.equal(canAccessDepartmentInbox('service', 'service'), true);
    assert.equal(canAccessDepartmentInbox('manager', 'sales'), true);
    assert.equal(canAccessDepartmentInbox('owner', 'service'), true);
    assert.equal(canAccessDepartmentInbox('parts', 'sales'), false);
    assert.equal(canAccessDepartmentInbox('sales', 'service'), false);
    assert.equal(canAccessDepartmentInbox('technician', 'sales'), false);
    assert.equal(canAccessDepartmentInbox('service_advisor', 'service'), false);
  });

  test('module catalog includes sales and service (not core_story)', () => {
    assert.ok(PRODUCT_MODULE_IDS.includes('sales'));
    assert.ok(PRODUCT_MODULE_IDS.includes('service'));
    assert.ok(!PRODUCT_MODULE_IDS.includes('core_story' as never));
    const ids = MODULE_CATALOG.map((e) => e.id);
    assert.ok(ids.includes('sales'));
    assert.ok(ids.includes('service'));
  });

  test('schema and migration add sales/service roles and modules', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const roleEnum = schema.match(/enum TechnicianRole \{[\s\S]*?\}/)?.[0] ?? '';
    const moduleEnum = schema.match(/enum ModuleId \{[\s\S]*?\}/)?.[0] ?? '';
    assert.ok(/\bsales\b/.test(roleEnum));
    assert.ok(/\bservice\b/.test(roleEnum));
    assert.ok(/\bsales\b/.test(moduleEnum));
    assert.ok(/\bservice\b/.test(moduleEnum));

    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20250729120000_department_sales_service/migration.sql'
      ),
      'utf8'
    );
    assert.ok(sql.includes("ADD VALUE 'sales'"));
    assert.ok(sql.includes("ADD VALUE 'service'"));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
  });

  test('shared DepartmentRequestDashboard + thin Sales/Service wrappers', () => {
    const shared = readFileSync(
      resolve(process.cwd(), 'src/components/department/DepartmentRequestDashboard.tsx'),
      'utf8'
    );
    assert.ok(shared.includes('DepartmentRequestDashboard'));
    assert.ok(shared.includes('InboxDepartmentId'));

    for (const [file, exportName] of [
      ['src/components/sales/SalesDashboard.tsx', 'SalesDashboard'],
      ['src/components/service/ServiceDashboard.tsx', 'ServiceDashboard'],
      ['src/components/parts/PartsDashboard.tsx', 'PartsDashboard'],
    ] as const) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes(exportName), file);
      assert.ok(src.includes('DepartmentRequestDashboard'), file);
    }
  });

  test('app shell wires sales/service views and manager tiles', () => {
    const app = readFileSync(
      resolve(process.cwd(), 'src/components/BenzTechAuthenticatedApp.tsx'),
      'utf8'
    );
    assert.ok(app.includes('SalesDashboard'));
    assert.ok(app.includes('ServiceDashboard'));
    assert.ok(app.includes("roleForUi === 'sales'"));
    assert.ok(app.includes("roleForUi === 'service'"));
    assert.ok(app.includes("setView('sales')"));
    assert.ok(app.includes("setView('service')"));

    const manager = readFileSync(
      resolve(process.cwd(), 'src/components/ManagerDashboard.tsx'),
      'utf8'
    );
    assert.ok(manager.includes('onOpenSales'));
    assert.ok(manager.includes('onOpenService'));
    assert.ok(manager.includes('Sales inbox'));
    assert.ok(manager.includes('Service inbox'));
  });

  test('settings + validation allow sales and service roles', () => {
    const settings = readFileSync(resolve(process.cwd(), 'src/components/SettingsView.tsx'), 'utf8');
    assert.ok(settings.includes('value="sales"'));
    assert.ok(settings.includes('value="service"'));

    const validation = readFileSync(resolve(process.cwd(), 'src/lib/validation.ts'), 'utf8');
    assert.ok(validation.includes("'sales'"));
    assert.ok(validation.includes("'service'"));
  });

  test('voice createDepartmentTicket gates sales and service modules', () => {
    const tools = readFileSync(resolve(process.cwd(), 'src/lib/voiceAgent/tools.ts'), 'utf8');
    assert.ok(tools.includes("department === 'sales' ? 'sales'"));
    assert.ok(tools.includes('isModuleEnabled(ctx.dealershipId, moduleId)'));
    assert.ok(!tools.includes('sales/service tickets always allowed'));
  });
});
