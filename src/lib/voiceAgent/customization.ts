/**
 * Dealership Personal Tailoring — load/save department customizations with cache + audit.
 */
import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { logger } from '@/lib/logger';
import { sanitizeText } from '@/lib/sanitize';

export const TAILORING_DEPARTMENTS = [
  'service',
  'parts',
  'sales',
  'loaner',
  'receptionist',
] as const;

export type TailoringDepartment = (typeof TAILORING_DEPARTMENTS)[number];

export type DepartmentCustomizationDto = {
  id: string | null;
  dealershipId: string;
  department: TailoringDepartment;
  customInstructions: string;
  greeting: string;
  disclaimers: string;
  toneGuidelines: string;
  version: number;
  updatedAt: string | null;
  updatedByTechnicianId: string | null;
  /** True when any non-empty custom field is set */
  isCustomized: boolean;
};

export type CustomizationVersionDto = {
  id: string;
  version: number;
  customInstructions: string;
  greeting: string;
  disclaimers: string;
  toneGuidelines: string;
  changedByTechnicianId: string | null;
  changeNote: string;
  createdAt: string;
};

export type CustomizationVars = {
  dealershipName?: string;
  managerName?: string;
  brand?: string;
  departmentLabel?: string;
};

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: DepartmentCustomizationDto }>();

const MAX_FIELD = 4_000;
const MAX_INSTRUCTIONS = 8_000;

export function isTailoringDepartment(value: string): value is TailoringDepartment {
  return (TAILORING_DEPARTMENTS as readonly string[]).includes(value);
}

function cacheKey(dealershipId: string, department: string): string {
  return `${dealershipId}:${department}`;
}

export function invalidateCustomizationCache(
  dealershipId?: string,
  department?: string
): void {
  if (!dealershipId) {
    cache.clear();
    return;
  }
  if (department) {
    cache.delete(cacheKey(dealershipId, department));
    return;
  }
  for (const k of cache.keys()) {
    if (k.startsWith(`${dealershipId}:`)) cache.delete(k);
  }
}

function emptyDto(
  dealershipId: string,
  department: TailoringDepartment
): DepartmentCustomizationDto {
  return {
    id: null,
    dealershipId,
    department,
    customInstructions: '',
    greeting: '',
    disclaimers: '',
    toneGuidelines: '',
    version: 0,
    updatedAt: null,
    updatedByTechnicianId: null,
    isCustomized: false,
  };
}

function isCustomized(fields: {
  customInstructions: string;
  greeting: string;
  disclaimers: string;
  toneGuidelines: string;
}): boolean {
  return Boolean(
    fields.customInstructions.trim() ||
      fields.greeting.trim() ||
      fields.disclaimers.trim() ||
      fields.toneGuidelines.trim()
  );
}

/** Strip control chars / HTML-ish markup; cap length. */
export function sanitizeCustomizationField(
  value: string | null | undefined,
  maxLen = MAX_FIELD
): string {
  const raw = (value || '').replace(/\0/g, '').slice(0, maxLen + 200);
  // Prefer project sanitizer when available
  const cleaned = sanitizeText(raw).slice(0, maxLen);
  return cleaned;
}

/**
 * Replace {dealershipName}, {managerName}, {brand}, {departmentLabel}.
 * Unknown braces left as-is (safe).
 */
export function applyCustomizationVariables(
  text: string,
  vars: CustomizationVars
): string {
  if (!text) return '';
  return text
    .replace(/\{dealershipName\}/gi, vars.dealershipName || 'our dealership')
    .replace(/\{managerName\}/gi, vars.managerName || 'the manager')
    .replace(/\{brand\}/gi, vars.brand || 'Mercedes-Benz')
    .replace(/\{departmentLabel\}/gi, vars.departmentLabel || 'this department');
}

export function buildTailoringPromptBlock(
  dto: DepartmentCustomizationDto,
  vars: CustomizationVars
): string {
  if (!dto.isCustomized) return '';
  const parts: string[] = ['## Dealership personal tailoring (manager-authored — follow these)'];
  if (dto.greeting.trim()) {
    parts.push(`Greeting preference: ${applyCustomizationVariables(dto.greeting, vars)}`);
  }
  if (dto.toneGuidelines.trim()) {
    parts.push(`Tone: ${applyCustomizationVariables(dto.toneGuidelines, vars)}`);
  }
  if (dto.customInstructions.trim()) {
    parts.push(
      `Custom instructions:\n${applyCustomizationVariables(dto.customInstructions, vars)}`
    );
  }
  if (dto.disclaimers.trim()) {
    parts.push(
      `Mandatory disclaimers (always honor):\n${applyCustomizationVariables(dto.disclaimers, vars)}`
    );
  }
  parts.push(
    'Tailoring never overrides safety, non-invention of inventory/prices/warranty coverage, or legal rules.'
  );
  return parts.join('\n');
}

export async function getDepartmentCustomization(
  dealershipId: string,
  department: TailoringDepartment
): Promise<DepartmentCustomizationDto> {
  const key = cacheKey(dealershipId, department);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const row = await withRlsBypass(async () =>
    getRlsDb().departmentCustomization.findUnique({
      where: {
        dealershipId_department: { dealershipId, department },
      },
    })
  );

  const dto: DepartmentCustomizationDto = row
    ? {
        id: row.id,
        dealershipId: row.dealershipId,
        department: department,
        customInstructions: row.customInstructions || '',
        greeting: row.greeting || '',
        disclaimers: row.disclaimers || '',
        toneGuidelines: row.toneGuidelines || '',
        version: row.version,
        updatedAt: row.updatedAt?.toISOString() ?? null,
        updatedByTechnicianId: row.updatedByTechnicianId,
        isCustomized: isCustomized(row),
      }
    : emptyDto(dealershipId, department);

  cache.set(key, { at: Date.now(), value: dto });
  return dto;
}

export async function listDepartmentCustomizations(
  dealershipId: string
): Promise<DepartmentCustomizationDto[]> {
  return Promise.all(
    TAILORING_DEPARTMENTS.map((d) => getDepartmentCustomization(dealershipId, d))
  );
}

export async function listCustomizationVersions(
  dealershipId: string,
  department: TailoringDepartment,
  take = 20
): Promise<CustomizationVersionDto[]> {
  const current = await getDepartmentCustomization(dealershipId, department);
  if (!current.id) return [];
  const rows = await withRlsBypass(async () =>
    getRlsDb().departmentCustomizationVersion.findMany({
      where: { customizationId: current.id! },
      orderBy: { version: 'desc' },
      take: Math.min(50, Math.max(1, take)),
    })
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    customInstructions: r.customInstructions || '',
    greeting: r.greeting || '',
    disclaimers: r.disclaimers || '',
    toneGuidelines: r.toneGuidelines || '',
    changedByTechnicianId: r.changedByTechnicianId,
    changeNote: r.changeNote || '',
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function saveDepartmentCustomization(input: {
  dealershipId: string;
  department: TailoringDepartment;
  customInstructions?: string;
  greeting?: string;
  disclaimers?: string;
  toneGuidelines?: string;
  actorTechnicianId: string;
  changeNote?: string;
}): Promise<DepartmentCustomizationDto> {
  const customInstructions = sanitizeCustomizationField(
    input.customInstructions,
    MAX_INSTRUCTIONS
  );
  const greeting = sanitizeCustomizationField(input.greeting);
  const disclaimers = sanitizeCustomizationField(input.disclaimers);
  const toneGuidelines = sanitizeCustomizationField(input.toneGuidelines);
  const changeNote = sanitizeCustomizationField(input.changeNote, 200);

  const saved = await withRlsBypass(async () => {
    const db = getRlsDb();
    const existing = await db.departmentCustomization.findUnique({
      where: {
        dealershipId_department: {
          dealershipId: input.dealershipId,
          department: input.department,
        },
      },
    });

    const nextVersion = (existing?.version ?? 0) + 1;

    const row = await db.departmentCustomization.upsert({
      where: {
        dealershipId_department: {
          dealershipId: input.dealershipId,
          department: input.department,
        },
      },
      create: {
        dealershipId: input.dealershipId,
        department: input.department,
        customInstructions,
        greeting,
        disclaimers,
        toneGuidelines,
        version: 1,
        updatedByTechnicianId: input.actorTechnicianId,
      },
      update: {
        customInstructions,
        greeting,
        disclaimers,
        toneGuidelines,
        version: nextVersion,
        updatedByTechnicianId: input.actorTechnicianId,
        updatedAt: new Date(),
      },
    });

    await db.departmentCustomizationVersion.create({
      data: {
        customizationId: row.id,
        version: row.version,
        customInstructions,
        greeting,
        disclaimers,
        toneGuidelines,
        changedByTechnicianId: input.actorTechnicianId,
        changeNote: changeNote || (existing ? 'Updated' : 'Created'),
      },
    });

    return row;
  });

  invalidateCustomizationCache(input.dealershipId, input.department);

  try {
    await writeAuditedAccess({
      action: 'voice.customization_update',
      dealershipId: input.dealershipId,
      technicianId: input.actorTechnicianId,
      entityType: 'departmentCustomization',
      entityId: saved.id,
      metadata: {
        department: input.department,
        version: saved.version,
        customized: isCustomized(saved),
        // lengths only — not free text
        instructionsLen: customInstructions.length,
        greetingLen: greeting.length,
        disclaimersLen: disclaimers.length,
        toneLen: toneGuidelines.length,
      },
    });
  } catch (error) {
    logger.warn('voice.customization_audit_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return getDepartmentCustomization(input.dealershipId, input.department);
}

export async function resetDepartmentCustomization(input: {
  dealershipId: string;
  department: TailoringDepartment;
  actorTechnicianId: string;
}): Promise<DepartmentCustomizationDto> {
  return saveDepartmentCustomization({
    dealershipId: input.dealershipId,
    department: input.department,
    customInstructions: '',
    greeting: '',
    disclaimers: '',
    toneGuidelines: '',
    actorTechnicianId: input.actorTechnicianId,
    changeNote: 'Reset to default',
  });
}

export async function restoreCustomizationVersion(input: {
  dealershipId: string;
  department: TailoringDepartment;
  version: number;
  actorTechnicianId: string;
}): Promise<DepartmentCustomizationDto> {
  const current = await getDepartmentCustomization(input.dealershipId, input.department);
  if (!current.id) {
    throw new Error('No customization history for this department');
  }
  const snap = await withRlsBypass(async () =>
    getRlsDb().departmentCustomizationVersion.findFirst({
      where: { customizationId: current.id!, version: input.version },
    })
  );
  if (!snap) throw new Error('Version not found');
  return saveDepartmentCustomization({
    dealershipId: input.dealershipId,
    department: input.department,
    customInstructions: snap.customInstructions,
    greeting: snap.greeting,
    disclaimers: snap.disclaimers,
    toneGuidelines: snap.toneGuidelines,
    actorTechnicianId: input.actorTechnicianId,
    changeNote: `Restored version ${input.version}`,
  });
}
