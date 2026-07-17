/**
 * PR-M1a — server-only finding encrypt/decrypt mappers.
 * Do not import from Client Components.
 */

import 'server-only';

import { encryptSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import {
  normalizeFindingFields,
  type FindingDto,
  type FindingInput,
  type FindingRow,
} from '@/lib/videoInspection/findings';
import type { MpiSeverity } from '@/lib/videoInspection/mpiCategories';

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

export function normalizeFindingInput(
  input: FindingInput,
  index: number
): {
  category: string;
  severity: MpiSeverity;
  noteEncrypted: string;
  timestampSec: number | null;
  framePathname: string | null;
  sortOrder: number;
} | null {
  const fields = normalizeFindingFields(input, index);
  if (!fields) return null;
  return {
    category: fields.category,
    severity: fields.severity,
    noteEncrypted: encryptSensitiveText(fields.note),
    timestampSec: fields.timestampSec,
    framePathname: fields.framePathname,
    sortOrder: fields.sortOrder,
  };
}
