import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  canAccessDepartmentInbox,
  isDepartmentId,
  isDepartmentRequestStatus,
  isPartsLineStatus,
} from '../../src/lib/department/constants';
import { last8OfVin, phoneLast4 } from '../../src/lib/department/piiHelpers';

describe('PR-M2 department request + Parts', () => {
  test('department and status validators', () => {
    assert.equal(isDepartmentId('parts'), true);
    assert.equal(isDepartmentId('finance'), false);
    assert.equal(isDepartmentRequestStatus('in_progress'), true);
    assert.equal(isPartsLineStatus('quoted'), true);
    assert.equal(isPartsLineStatus('shipped'), false);
  });

  test('inbox access: parts staff + managers, not bare technicians', () => {
    assert.equal(canAccessDepartmentInbox('parts', 'parts'), true);
    assert.equal(canAccessDepartmentInbox('manager', 'parts'), true);
    assert.equal(canAccessDepartmentInbox('owner', 'parts'), true);
    assert.equal(canAccessDepartmentInbox('technician', 'parts'), false);
    assert.equal(canAccessDepartmentInbox('service_advisor', 'parts'), false);
  });

  test('PII display helpers', () => {
    assert.equal(last8OfVin('WDDHF5KB9EA123456'), 'EA123456');
    assert.equal(phoneLast4('(401) 555-0199'), '0199');
  });

  test('schema defines DepartmentRequest, Parts lines, parts role', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model DepartmentRequest'));
    assert.ok(schema.includes('model PartsRequestLine'));
    assert.ok(schema.includes('model PartsLookupEvent'));
    const enumBlock = schema.match(/enum TechnicianRole \{[\s\S]*?\}/)?.[0] ?? '';
    assert.ok(/\bparts\b/.test(enumBlock));
  });

  test('migration creates tables and RLS without touching RO story tables', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20250724120000_department_request_parts/migration.sql'
      ),
      'utf8'
    );
    assert.ok(sql.includes('DepartmentRequest'));
    assert.ok(sql.includes('PartsRequestLine'));
    assert.ok(sql.includes('PartsLookupEvent'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes("ADD VALUE 'parts'"));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
  });

  test('API routes gate via department module helper (not static parts-only)', () => {
    for (const file of [
      'src/app/api/department-requests/route.ts',
      'src/app/api/department-requests/[id]/route.ts',
      'src/app/api/department-requests/[id]/parts-lines/route.ts',
      'src/app/api/department-requests/[id]/lookups/route.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(
        src.includes('assertDepartmentModuleEnabled') ||
          src.includes("requireModule: 'parts'") ||
          src.includes('requireModule: moduleId'),
        file
      );
    }
  });

  test('shared inbox foundation and parts dashboard exist', () => {
    const inbox = readFileSync(
      resolve(process.cwd(), 'src/components/department/DepartmentInbox.tsx'),
      'utf8'
    );
    assert.ok(inbox.includes('DepartmentInbox'));
    const dash = readFileSync(
      resolve(process.cwd(), 'src/components/parts/PartsDashboard.tsx'),
      'utf8'
    );
    assert.ok(dash.includes('PartsDashboard'));
    assert.ok(dash.includes('DepartmentRequestDashboard') || dash.includes('createDepartmentRequest'));
  });
});
