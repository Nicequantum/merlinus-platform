import 'server-only';

import type {
  ExtractedData,
  ImageAttachment,
  RepairLine,
  RepairLineSummary,
  RepairOrder,
  RepairOrderSummary,
  StoryQualityResult,
} from '@/types';
import type { RepairLine as DbLine, RepairOrder as DbRO } from '@prisma/client';
import {
  decryptComplaintsPayload,
  decryptJsonObject,
  decryptStringArray,
  encryptComplaintsPayload,
  encryptJsonObject,
  encryptOptionalSensitiveText,
  encryptPII,
  encryptSensitiveText,
  encryptStringArray,
} from './encryption';
import { emptyExtractedData } from '@/utils/diagnosticParser';
import { mapStoryCertificationFromDbLine, storyCertificationMatchesStory } from './storyCertification';
import { mapSoldMetricsFromDb } from './repairLineSoldMetrics';
import { sanitizeForCDK } from './sanitizeForCDK';
import { buildImageProxyUrl, extractPathnameFromImageRef } from './imageUrls';
import {
  appendPiiDecryptWarning,
  readAdvisorDisplayNameTolerant,
  readDescriptionTolerant,
  readEncryptedPiiTolerant,
  readOptionalSensitiveTextTolerant,
  readRoNumberTolerant,
  readSensitiveTextTolerant,
} from './piiFieldRead';
import { buildRoNumberSearchTokens } from './piiSearchToken';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseImageAttachments(raw: string): ImageAttachment[] {
  const parsed = parseJson<unknown>(raw, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      if (typeof item === 'string') {
        const pathname = extractPathnameFromImageRef(item);
        if (!pathname) return null;
        return { id: `img-${pathname.slice(-12)}`, pathname, url: buildImageProxyUrl(pathname), name: 'image.jpg' };
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        const pathname =
          typeof record.pathname === 'string'
            ? record.pathname
            : extractPathnameFromImageRef(typeof record.url === 'string' ? record.url : '');
        if (!pathname || !pathname.startsWith('benz-tech/')) return null;
        return {
          id: typeof record.id === 'string' ? record.id : `img-${Date.now()}`,
          pathname,
          url: buildImageProxyUrl(pathname),
          name: typeof record.name === 'string' ? record.name : 'image.jpg',
        };
      }
      return null;
    })
    .filter((img): img is ImageAttachment => img !== null);
}

export function normalizeImageAttachments(
  images?: Array<{ id: string; pathname?: string; url?: string; name: string }>
): ImageAttachment[] {
  return (images || [])
    .map((img) => {
      const pathname = img.pathname || extractPathnameFromImageRef(img.url || '');
      if (!pathname || !pathname.startsWith('benz-tech/')) return null;
      return {
        id: img.id,
        pathname,
        url: buildImageProxyUrl(pathname),
        name: img.name,
      };
    })
    .filter((img): img is ImageAttachment => img !== null);
}

export function sanitizeImageAttachments(images?: ImageAttachment[]): ImageAttachment[] {
  return (images || [])
    .filter((img) => img.pathname?.startsWith('benz-tech/'))
    .map((img) => ({
      id: img.id,
      pathname: img.pathname,
      url: buildImageProxyUrl(img.pathname),
      name: img.name,
    }));
}

export function imageAttachmentsToJson(images?: ImageAttachment[]): string {
  return JSON.stringify(
    sanitizeImageAttachments(images).map(({ id, pathname, name }) => ({ id, pathname, name }))
  );
}

type DbROWithAdvisor = DbRO & {
  repairLines: DbLine[];
  serviceAdvisor?: { id: string; displayNameEncrypted?: string } | null;
};

type DbROListRow = DbRO & {
  repairLines: DbLine[];
  technician?: { name: string } | null;
};

function dbToRepairLineSummary(line: DbLine): RepairLineSummary {
  return {
    id: line.id,
    lineNumber: line.lineNumber,
    isCustomerPay: line.isCustomerPay ?? false,
    hasWarrantyStory: Boolean(line.warrantyStoryEncrypted?.trim()),
    soldMetrics: mapSoldMetricsFromDb(
      line as DbLine & {
        soldLaborHours?: number | null;
        soldLaborAmount?: number | null;
        soldPartsAmount?: number | null;
        customerApproved?: boolean | null;
        isAddOn?: boolean | null;
        soldMetricsUpdatedAt?: Date | null;
      }
    ),
  };
}

/** List/search DTO — decrypts RO number and first complaint only; lines stay ciphertext-aware. */
export function dbToRepairOrderSummary(ro: DbROListRow): RepairOrderSummary {
  const roNumber = readRoNumberTolerant(ro).value;
  const complaintsPayload = decryptComplaintsPayload(ro.complaintsEncrypted);
  const firstComplaintPreview = complaintsPayload.complaints[0]?.trim() || undefined;

  return {
    id: ro.id,
    roNumber,
    vehicle: {
      year: ro.year,
      make: ro.make,
      model: ro.model,
    },
    firstComplaintPreview,
    repairLines: ro.repairLines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map(dbToRepairLineSummary),
    createdAt: ro.createdAt.toISOString(),
    updatedAt: ro.updatedAt.toISOString(),
    technicianId: ro.technicianId,
    technicianName: ro.technician?.name,
  };
}

export function dbToRepairOrder(ro: DbROWithAdvisor): RepairOrder {
  const piiDecryptWarnings: string[] = [];

  const roNumberRead = readRoNumberTolerant(ro);
  appendPiiDecryptWarning(piiDecryptWarnings, 'RO number', roNumberRead);

  const vinRead = readEncryptedPiiTolerant({ encrypted: ro.vinEncrypted });
  appendPiiDecryptWarning(piiDecryptWarnings, 'VIN', vinRead);

  const customerNameRead = readEncryptedPiiTolerant({ encrypted: ro.customerNameEncrypted });
  appendPiiDecryptWarning(piiDecryptWarnings, 'Customer name', customerNameRead);

  const advisorNameRead = readEncryptedPiiTolerant({ encrypted: ro.serviceAdvisorNameEncrypted });
  appendPiiDecryptWarning(piiDecryptWarnings, 'Service advisor name', advisorNameRead);

  const serviceAdvisorDisplayNameRead = ro.serviceAdvisor
    ? readAdvisorDisplayNameTolerant(ro.serviceAdvisor)
    : { value: '', decryptFailed: false };
  if (ro.serviceAdvisor) {
    appendPiiDecryptWarning(piiDecryptWarnings, 'Service advisor display name', serviceAdvisorDisplayNameRead);
  }

  const complaintsPayload = decryptComplaintsPayload(ro.complaintsEncrypted);

  return {
    id: ro.id,
    roNumber: roNumberRead.value,
    vehicle: {
      vin: vinRead.value,
      year: ro.year,
      make: ro.make,
      model: ro.model,
      engine: ro.engine,
      mileageIn: ro.mileageIn,
      mileageOut: ro.mileageOut,
    },
    customer: { name: customerNameRead.value },
    complaints: complaintsPayload.complaints,
    complaintLabels: complaintsPayload.labels,
    serviceAdvisor: ro.serviceAdvisor
      ? {
          id: ro.serviceAdvisor.id,
          displayName: serviceAdvisorDisplayNameRead.value || '',
          matchConfidence: ro.advisorMatchConfidence ?? undefined,
        }
      : undefined,
    serviceAdvisorName: advisorNameRead.value || serviceAdvisorDisplayNameRead.value || undefined,
    xentryImages: parseImageAttachments(ro.xentryImageUrls),
    xentryOcrTexts: decryptStringArray(ro.xentryOcrTextsEncrypted),
    repairLines: ro.repairLines
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((line) => dbToRepairLine(line, piiDecryptWarnings)),
    createdAt: ro.createdAt.toISOString(),
    updatedAt: ro.updatedAt.toISOString(),
    technicianId: ro.technicianId,
    technicianName: undefined,
    ...(piiDecryptWarnings.length > 0 ? { piiDecryptWarnings } : {}),
  };
}

export function dbToRepairLine(line: DbLine, piiDecryptWarnings?: string[]): RepairLine {
  const warnings = piiDecryptWarnings ?? [];
  const lineLabel = (field: string) => `Line ${line.lineNumber} ${field}`;

  const descriptionRead = readDescriptionTolerant(line);
  appendPiiDecryptWarning(warnings, lineLabel('description'), descriptionRead);

  const customerConcernRead = readEncryptedPiiTolerant({ encrypted: line.customerConcernEncrypted });
  appendPiiDecryptWarning(warnings, lineLabel('customer concern'), customerConcernRead);

  const technicianNotesRead = readSensitiveTextTolerant(line.technicianNotesEncrypted);
  appendPiiDecryptWarning(warnings, lineLabel('technician notes'), technicianNotesRead);

  const warrantyStoryRead = readOptionalSensitiveTextTolerant(line.warrantyStoryEncrypted);
  appendPiiDecryptWarning(warnings, lineLabel('warranty story'), warrantyStoryRead);
  const warrantyStory = warrantyStoryRead.decryptFailed
    ? undefined
    : warrantyStoryRead.value || undefined;

  return {
    id: line.id,
    lineNumber: line.lineNumber,
    description: descriptionRead.value,
    customerConcern: customerConcernRead.value,
    technicianNotes: technicianNotesRead.value,
    xentryImages: parseImageAttachments(line.xentryImageUrls),
    xentryOcrTexts: decryptStringArray(line.xentryOcrTextsEncrypted),
    extractedData: decryptJsonObject<ExtractedData>(line.extractedDataEncrypted, emptyExtractedData()),
    warrantyStory,
    storyQualityAudit: parseStoryQualityAudit(
      (line as DbLine & { storyQualityAuditEncrypted?: string }).storyQualityAuditEncrypted
    ),
    isCustomerPay: line.isCustomerPay ?? false,
    soldMetrics: mapSoldMetricsFromDb(
      line as DbLine & {
        soldLaborHours?: number | null;
        soldLaborAmount?: number | null;
        soldPartsAmount?: number | null;
        customerApproved?: boolean | null;
        isAddOn?: boolean | null;
        soldMetricsUpdatedAt?: Date | null;
      }
    ),
    storyCertification: (() => {
      const certification = mapStoryCertificationFromDbLine(
        line as DbLine & {
          storyCertifiedAt?: Date | null;
          storyCertifiedByTechnicianId?: string | null;
          storyCertifiedByNameEncrypted?: string;
          storyCertifiedHash?: string;
        }
      );
      if (!certification || !storyCertificationMatchesStory(certification, warrantyStory)) {
        return null;
      }
      return certification;
    })(),
  };
}

function parseStoryQualityAudit(raw: string | undefined | null): StoryQualityResult | null {
  if (!raw?.trim()) return null;
  const parsed = decryptJsonObject<StoryQualityResult | null>(raw, null);
  if (!parsed || typeof parsed.score !== 'number') return null;
  return parsed;
}

export interface RepairOrderInput {
  roNumber: string;
  vehicle: {
    vin: string;
    year: string;
    make: string;
    model: string;
    engine?: string;
    mileageIn: string;
    mileageOut: string;
  };
  customer: { name: string };
  complaints: string[];
  complaintLabels?: string[];
  xentryImages?: ImageAttachment[];
  xentryOcrTexts?: string[];
  repairLines: RepairLine[];
}

export function repairOrderToDbFields(
  input: RepairOrderInput & { serviceAdvisorName?: string }
) {
  const roNumber = input.roNumber.trim();

  return {
    roNumberEncrypted: encryptPII(roNumber),
    // SQLite/D1: store blind-index tokens as JSON string (no String[] / GIN).
    roNumberSearchTokens: JSON.stringify(buildRoNumberSearchTokens(roNumber)),
    vinEncrypted: encryptPII(input.vehicle.vin),
    year: input.vehicle.year,
    make: input.vehicle.make,
    model: input.vehicle.model,
    engine: input.vehicle.engine || '',
    mileageIn: input.vehicle.mileageIn,
    mileageOut: input.vehicle.mileageOut,
    customerNameEncrypted: encryptPII(input.customer.name),
    complaintsEncrypted: encryptComplaintsPayload(input.complaints, input.complaintLabels),
    xentryImageUrls: imageAttachmentsToJson(input.xentryImages),
    xentryOcrTextsEncrypted: encryptStringArray(input.xentryOcrTexts || []),
    ...(input.serviceAdvisorName
      ? { serviceAdvisorNameEncrypted: encryptPII(input.serviceAdvisorName) }
      : {}),
  };
}

export function repairLineToDbFields(line: RepairLine) {
  return {
    lineNumber: line.lineNumber,
    descriptionEncrypted: encryptSensitiveText(line.description),
    customerConcernEncrypted: encryptPII(line.customerConcern),
    technicianNotesEncrypted: encryptSensitiveText(line.technicianNotes),
    xentryImageUrls: imageAttachmentsToJson(line.xentryImages),
    xentryOcrTextsEncrypted: encryptStringArray(line.xentryOcrTexts || []),
    extractedDataEncrypted: encryptJsonObject(line.extractedData || emptyExtractedData()),
    warrantyStoryEncrypted: encryptOptionalSensitiveText(
      line.warrantyStory ? sanitizeForCDK(line.warrantyStory) : line.warrantyStory
    ),
    ...(line.storyQualityAudit !== undefined
      ? {
          storyQualityAuditEncrypted: line.storyQualityAudit
            ? encryptJsonObject(line.storyQualityAudit)
            : '',
        }
      : {}),
    isCustomerPay: line.isCustomerPay ?? false,
  };
}