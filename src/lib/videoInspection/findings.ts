/**
 * PR-M1a — finding row helpers (encrypt notes, checklist snapshot).
 */

import { encryptSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import {
  computeSeveritySummary,
  isMpiCategory,
  isMpiSeverity,
  type MpiCategory,
  type MpiSeverity,
} from '@/lib/videoInspection/mpiCategories';

export type FindingInput = {
  category: string;
  severity?: string;
  note?: string;
  timestampSec?: number | null;
  framePathname?: string | null;
  sortOrder?: number;
};

export type FindingRow = {
  id: string;
  category: string;
  severity: string;
  noteEncrypted: string;
  timestampSec: number | null;
  framePathname: string | null;
  sortOrder: number;
};

export type FindingDto = {
  id: string;
  category: string;
  severity: MpiSeverity | string;
  note: string;
  timestampSec: number | null;
  framePathname: string | null;
  sortOrder: number;
};

export function mapFindingDto(row: FindingRow): FindingDto {
  return {
    id: row.id,
    category: row.category,
    severity: row.severity,
    note: decryptSensitiveText(row.noteEncrypted || ''),
    timestampSec: row.timestampSec,
    framePathname: row.framePathname,
    sortOrder: row.sortOrder,
  };
}

export function normalizeFindingInput(input: FindingInput, index: number): {
  category: string;
  severity: MpiSeverity;
  noteEncrypted: string;
  timestampSec: number | null;
  framePathname: string | null;
  sortOrder: number;
} | null {
  const category = input.category?.trim() || '';
  if (!category) return null;
  const severity: MpiSeverity = isMpiSeverity(input.severity || '')
    ? (input.severity as MpiSeverity)
    : 'ok';
  const note = (input.note ?? '').slice(0, 4000);
  const sortOrder =
    typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder)
      ? Math.floor(input.sortOrder)
      : index;
  const timestampSec =
    typeof input.timestampSec === 'number' && Number.isFinite(input.timestampSec)
      ? input.timestampSec
      : null;
  const framePathname = input.framePathname?.trim() || null;

  return {
    category: isMpiCategory(category) ? category : category.slice(0, 64),
    severity,
    noteEncrypted: encryptSensitiveText(note),
    timestampSec,
    framePathname,
    sortOrder,
  };
}

export function checklistSnapshotFromFindings(
  findings: ReadonlyArray<{ category: string; severity: string; note?: string }>
): string {
  return JSON.stringify(
    findings.map((f) => ({
      category: f.category,
      severity: f.severity,
      note: (f.note ?? '').slice(0, 500),
    }))
  );
}

export function severityAndChecklistFromDtos(findings: FindingDto[]): {
  severitySummary: string;
  mpiChecklistJson: string;
} {
  return {
    severitySummary: computeSeveritySummary(findings),
    mpiChecklistJson: checklistSnapshotFromFindings(findings),
  };
}

export function defaultChecklistTemplate(): Array<{
  category: MpiCategory;
  severity: MpiSeverity;
  note: string;
}> {
  const core: MpiCategory[] = [
    'tires_wheels',
    'brakes',
    'battery_charging',
    'fluids_leaks',
    'lights_electrical',
    'wipers_visibility',
    'suspension_steering',
    'exterior_body',
  ];
  return core.map((category) => ({ category, severity: 'ok' as const, note: '' }));
}
