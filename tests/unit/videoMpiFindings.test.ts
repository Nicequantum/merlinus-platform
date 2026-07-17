import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  computeSeveritySummary,
  isMpiCategory,
  isMpiSeverity,
  last8OfVin,
  phoneLast4,
  parseSeveritySummary,
} from '../../src/lib/videoInspection/mpiCategories';
import {
  checklistSnapshotFromFindings,
  defaultChecklistTemplate,
} from '../../src/lib/videoInspection/findings';

describe('PR-M1a Video MPI findings', () => {
  test('severity summary aggregates ok / recommend / urgent', () => {
    const summary = computeSeveritySummary([
      { severity: 'ok' },
      { severity: 'ok' },
      { severity: 'recommend' },
      { severity: 'urgent' },
      { severity: 'unknown' },
    ]);
    assert.equal(summary, 'ok:2|recommend:1|urgent:1');
    assert.deepEqual(parseSeveritySummary(summary), {
      ok: 2,
      recommend: 1,
      urgent: 1,
    });
  });

  test('VIN last8 and phone last4 helpers', () => {
    assert.equal(last8OfVin('WDDHF5KB9EA123456'), 'EA123456');
    assert.equal(last8OfVin('abc'), 'ABC');
    assert.equal(phoneLast4('(401) 555-0199'), '0199');
    assert.equal(phoneLast4('12'), '12');
  });

  test('category and severity validators', () => {
    assert.equal(isMpiCategory('brakes'), true);
    assert.equal(isMpiCategory('warp_drive'), false);
    assert.equal(isMpiSeverity('urgent'), true);
    assert.equal(isMpiSeverity('critical'), false);
  });

  test('default checklist template is non-empty multipoint set', () => {
    const tpl = defaultChecklistTemplate();
    assert.ok(tpl.length >= 6);
    assert.ok(tpl.every((r) => r.severity === 'ok'));
    const snap = checklistSnapshotFromFindings(tpl);
    const parsed = JSON.parse(snap) as unknown[];
    assert.equal(parsed.length, tpl.length);
  });

  test('schema defines VideoInspectionFinding and MPI columns', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model VideoInspectionFinding'));
    assert.ok(schema.includes('mpiChecklistJson'));
    assert.ok(schema.includes('severitySummary'));
    assert.ok(schema.includes('customerNameEncrypted'));
    assert.ok(schema.includes('vinEncrypted'));
    assert.ok(schema.includes('recordingMode'));
    // Must not alter story pipeline models in this PR
    assert.ok(schema.includes('model RepairLine'));
  });

  test('migration creates findings table, RLS, and video_mpi backfill', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20250722120000_video_mpi_findings/migration.sql'),
      'utf8'
    );
    assert.ok(sql.includes('VideoInspectionFinding'));
    assert.ok(sql.includes('mpiChecklistJson'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(sql.includes("video_mpi"));
    assert.ok(sql.includes('INSERT INTO "DealershipModule"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
  });

  test('authenticated video routes require video_mpi module', () => {
    const files = [
      'src/app/api/video-inspections/route.ts',
      'src/app/api/video-inspections/upload/route.ts',
      'src/app/api/video-inspections/[id]/route.ts',
      'src/app/api/video-inspections/[id]/findings/route.ts',
      'src/app/api/video-inspections/[id]/generate-report/route.ts',
      'src/app/api/video-inspections/[id]/share/route.ts',
      'src/app/api/video-inspections/[id]/send-sms/route.ts',
      'src/app/api/video-inspections/[id]/media/route.ts',
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes("video_mpi") || src.includes("requireModule: 'video_mpi'"), file);
    }
  });
});
