import 'server-only';

import { createHash } from 'crypto';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { GROK_CHAT_MODEL } from '@/lib/grokModels';
import type { ExtractedData } from '@/types';

export interface DiagnosticExtractAuditInput {
  dealershipId: string;
  dealerId?: string | null;
  technicianId: string;
  pathname: string;
  durationMs: number;
  extracted: ExtractedData;
  ipAddress?: string;
}

/** PII-free quality signals for diagnostics.extract audit metadata. */
export function buildDiagnosticExtractAuditMetadata(input: {
  pathname: string;
  durationMs: number;
  extracted: ExtractedData;
  model?: string;
}): Record<string, unknown> {
  const faultCodeCount = Math.max(
    input.extracted.faultCodes?.length ?? 0,
    input.extracted.codes?.length ?? 0
  );

  const pathnameDigest = createHash('sha256')
    .update(input.pathname, 'utf8')
    .digest('hex')
    .slice(0, 16);

  return {
    durationMs: Math.max(0, Math.round(input.durationMs)),
    model: input.model ?? GROK_CHAT_MODEL,
    extractionSource: 'grok',
    faultCodeCount,
    measurementCount: input.extracted.measurements?.length ?? 0,
    guidedTestCount: input.extracted.guidedTests?.length ?? 0,
    componentCount: input.extracted.components?.length ?? 0,
    circuitCount: input.extracted.circuits?.length ?? 0,
    hasDiagnosticContent: faultCodeCount > 0 || (input.extracted.measurements?.length ?? 0) > 0,
    success: true,
    pathnameDigest,
  };
}

/** Critical audit — Xentry AI provenance; failure aborts the extract response. */
export async function writeDiagnosticExtractAudit(input: DiagnosticExtractAuditInput): Promise<void> {
  const metadata = buildDiagnosticExtractAuditMetadata({
    pathname: input.pathname,
    durationMs: input.durationMs,
    extracted: input.extracted,
  });

  // Phase 6.3 — fail-closed diagnostic extract provenance
  await writeAuditedAccess({
    action: 'diagnostics.extract',
    dealershipId: input.dealershipId,
    dealerId: input.dealerId,
    technicianId: input.technicianId,
    entityType: 'image',
    entityId: `diag-${metadata.pathnameDigest}`,
    metadata,
    ipAddress: input.ipAddress,
  });
}