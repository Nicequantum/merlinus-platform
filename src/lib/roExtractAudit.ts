import 'server-only';

import { createHash } from 'crypto';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { GROK_CHAT_MODEL } from '@/lib/grokModels';
import { assessRoExtractionQuality } from '@/lib/scanPipeline';
import type { StructuredROExtraction } from '@/types';

export interface RoExtractAuditInput {
  dealershipId: string;
  dealerId?: string | null;
  technicianId: string;
  pageCount: number;
  durationMs: number;
  extracted: StructuredROExtraction;
  ipAddress?: string;
}

/** Structured, PII-free provenance metadata for hash-chained ro.extract audit entries. */
export function buildRoExtractAuditMetadata(input: {
  pageCount: number;
  durationMs: number;
  extracted: StructuredROExtraction;
  model?: string;
}): Record<string, unknown> {
  const quality = assessRoExtractionQuality(input.extracted);
  const pathnameDigest = createHash('sha256')
    .update(`pages:${input.pageCount}`, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return {
    pageCount: input.pageCount,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    model: input.model ?? GROK_CHAT_MODEL,
    extractionSource: 'grok',
    extractionStrength: quality.extractionStrength,
    complaintCount: quality.complaintCount,
    complaintLabelCount: quality.complaintLabelCount,
    hasRoNumber: quality.hasRoNumber,
    hasVin17: quality.hasVin17,
    hasVehicleIdentity: quality.hasVehicleIdentity,
    success: true,
    pathnameDigest,
  };
}

/** Critical audit — scan provenance is compliance-relevant; failure aborts the extract response. */
export async function writeRoExtractAudit(input: RoExtractAuditInput): Promise<void> {
  // Phase 6.3 — fail-closed extract provenance
  await writeAuditedAccess({
    action: 'ro.extract',
    dealershipId: input.dealershipId,
    dealerId: input.dealerId,
    technicianId: input.technicianId,
    entityType: 'image',
    entityId: `scan-${input.pageCount}pg`,
    metadata: buildRoExtractAuditMetadata({
      pageCount: input.pageCount,
      durationMs: input.durationMs,
      extracted: input.extracted,
    }),
    ipAddress: input.ipAddress,
  });
}