import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  canManageMaintenance,
  canSubmitMaintenance,
  isMaintenanceSeverity,
  isMaintenanceStatus,
  MAINTENANCE_KANBAN_COLUMNS,
} from '../../src/lib/maintenance/constants';

describe('PR-M3 maintenance tickets', () => {
  test('severity and status validators', () => {
    assert.equal(isMaintenanceSeverity('critical'), true);
    assert.equal(isMaintenanceSeverity('extreme'), false);
    assert.equal(isMaintenanceStatus('in_progress'), true);
    assert.equal(isMaintenanceStatus('open'), false);
    assert.ok(MAINTENANCE_KANBAN_COLUMNS.includes('submitted'));
    assert.ok(!MAINTENANCE_KANBAN_COLUMNS.includes('done'));
  });

  test('role access: submit broadly, manage for facilities/managers', () => {
    assert.equal(canSubmitMaintenance('technician'), true);
    assert.equal(canSubmitMaintenance('parts'), true);
    assert.equal(canSubmitMaintenance('maintenance'), true);
    assert.equal(canManageMaintenance('maintenance'), true);
    assert.equal(canManageMaintenance('manager'), true);
    assert.equal(canManageMaintenance('technician'), false);
    assert.equal(canManageMaintenance('parts'), false);
  });

  test('schema defines ticket/photo/event and maintenance role', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model MaintenanceTicket'));
    assert.ok(schema.includes('model MaintenancePhoto'));
    assert.ok(schema.includes('model MaintenanceTicketEvent'));
    assert.ok(schema.includes('enum MaintenanceSeverity'));
    assert.ok(schema.includes('enum MaintenanceTicketStatus'));
    const enumBlock = schema.match(/enum TechnicianRole \{[\s\S]*?\}/)?.[0] ?? '';
    assert.ok(/\bmaintenance\b/.test(enumBlock));
  });

  test('migration enables RLS without touching RO/Parts tables', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20250725120000_maintenance_tickets/migration.sql'),
      'utf8'
    );
    assert.ok(sql.includes('MaintenanceTicket'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes("ADD VALUE 'maintenance'"));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
    assert.ok(!sql.includes('ALTER TABLE "DepartmentRequest"'));
  });

  test('API routes require maintenance module', () => {
    for (const file of [
      'src/app/api/maintenance/tickets/route.ts',
      'src/app/api/maintenance/tickets/[id]/route.ts',
      'src/app/api/maintenance/tickets/[id]/photos/route.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes("requireModule: 'maintenance'"), file);
    }
  });

  test('kanban dashboard exists', () => {
    const ui = readFileSync(
      resolve(process.cwd(), 'src/components/maintenance/MaintenanceDashboard.tsx'),
      'utf8'
    );
    assert.ok(ui.includes('MaintenanceDashboard'));
    assert.ok(ui.includes('MAINTENANCE_KANBAN_COLUMNS'));
    assert.ok(ui.includes('createMaintenanceTicket'));
  });
});
