import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  canAccessLoanerModule,
  canManageLoanerFleet,
  isLoanerAssignmentStatus,
  isLoanerVehicleStatus,
  LOANER_BLOCKED_FOR_RESERVE,
} from '../../src/lib/loaner/constants';

describe('PR-M4 loaner fleet', () => {
  test('status validators and reserve blocks', () => {
    assert.equal(isLoanerVehicleStatus('available'), true);
    assert.equal(isLoanerVehicleStatus('sold'), false);
    assert.equal(isLoanerAssignmentStatus('active'), true);
    assert.ok(LOANER_BLOCKED_FOR_RESERVE.has('out'));
    assert.ok(!LOANER_BLOCKED_FOR_RESERVE.has('available'));
  });

  test('role access for desk vs inventory manage', () => {
    assert.equal(canAccessLoanerModule('loaner'), true);
    assert.equal(canAccessLoanerModule('service_advisor'), true);
    assert.equal(canAccessLoanerModule('technician'), false);
    assert.equal(canManageLoanerFleet('loaner'), true);
    assert.equal(canManageLoanerFleet('manager'), true);
    assert.equal(canManageLoanerFleet('service_advisor'), false);
  });

  test('schema defines vehicles, assignments, loaner role', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model LoanerVehicle'));
    assert.ok(schema.includes('model LoanerAssignment'));
    assert.ok(schema.includes('enum LoanerVehicleStatus'));
    assert.ok(schema.includes('enum LoanerAssignmentStatus'));
    const enumBlock = schema.match(/enum TechnicianRole \{[\s\S]*?\}/)?.[0] ?? '';
    assert.ok(/\bloaner\b/.test(enumBlock));
  });

  test('migration RLS without touching other modules', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20250726120000_loaner_fleet/migration.sql'),
      'utf8'
    );
    assert.ok(sql.includes('LoanerVehicle'));
    assert.ok(sql.includes('LoanerAssignment'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes("ADD VALUE 'loaner'"));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "DepartmentRequest"'));
    assert.ok(!sql.includes('ALTER TABLE "MaintenanceTicket"'));
    assert.ok(!sql.includes('ALTER TABLE "VideoInspection"'));
  });

  test('service helpers exist for future Loaner agent', () => {
    const svc = readFileSync(resolve(process.cwd(), 'src/lib/loaner/service.ts'), 'utf8');
    assert.ok(svc.includes('listAvailableLoaners'));
    assert.ok(svc.includes('createLoanerReservation'));
    assert.ok(svc.includes('checkoutLoanerAssignment'));
    assert.ok(svc.includes('returnLoanerAssignment'));
    assert.ok(svc.includes('dealershipId'));
  });

  test('API routes require loaner module', () => {
    for (const file of [
      'src/app/api/loaner/vehicles/route.ts',
      'src/app/api/loaner/vehicles/[id]/route.ts',
      'src/app/api/loaner/assignments/route.ts',
      'src/app/api/loaner/assignments/[id]/route.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes("requireModule: 'loaner'"), file);
    }
  });

  test('dashboard component exists', () => {
    const ui = readFileSync(
      resolve(process.cwd(), 'src/components/loaner/LoanerDashboard.tsx'),
      'utf8'
    );
    assert.ok(ui.includes('LoanerDashboard'));
    assert.ok(ui.includes('createLoanerAssignment'));
  });
});
