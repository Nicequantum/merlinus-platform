/**
 * Durable queue handler — Video MPI customer report generation.
 */
import 'server-only';

import { markAiJobProgress } from '@/lib/aiJobs/service';
import type { AiQueueMessage } from '@/lib/queue/types';
import { logger } from '@/lib/logger';

/**
 * MPI report job. Reuses generateCustomerVideoReport path when possible.
 * Prefer enqueueing from generate-report route with inspectionId.
 */
export async function handleMpiReportJob(
  msg: AiQueueMessage
): Promise<Record<string, unknown>> {
  const inspectionId =
    (typeof msg.payload.inspectionId === 'string' && msg.payload.inspectionId) ||
    (typeof msg.payload.entityId === 'string' && msg.payload.entityId) ||
    '';
  if (!inspectionId) {
    throw new Error('mpi.report requires payload.inspectionId');
  }
  if (!msg.dealershipId?.trim()) {
    throw new Error('mpi.report requires dealershipId');
  }

  await markAiJobProgress(msg.jobId, 15);

  const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
  const { decryptSensitiveText, encryptSensitiveText } = await import('@/lib/encryption');
  const { generateCustomerVideoReport } = await import('@/lib/grok');
  const { buildFallbackCustomerVideoReport } = await import(
    '@/lib/videoInspection/fallbackCustomerReport'
  );
  const { parseFramePathnames } = await import('@/lib/videoInspection/mappers');
  const { mapFindingDto } = await import('@/lib/videoInspection/findingsServer');
  const { CUSTOMER_VIDEO_REPORT_PROMPT_VERSION } = await import(
    '@/prompts/customerVideoReport/version'
  );

  const tenantWhere = { id: inspectionId, dealershipId: msg.dealershipId };

  const inspection = await withRlsBypass(async () =>
    getRlsDb().videoInspection.findFirst({
      where: tenantWhere,
      include: {
        dealership: { select: { name: true } },
        findings: { orderBy: { sortOrder: 'asc' as const } },
      },
    })
  );

  if (!inspection) throw new Error('Video inspection not found');
  if (!inspection.videoPathname?.trim()) {
    throw new Error('Upload a video before generating a report');
  }

  await withRlsBypass(async () => {
    await getRlsDb().videoInspection.updateMany({
      where: tenantWhere,
      data: { status: 'processing', errorMessage: null },
    });
  });

  await markAiJobProgress(msg.jobId, 35);

  const transcript = decryptSensitiveText(inspection.transcriptEncrypted || '');
  const framePaths = parseFramePathnames(inspection.framePathnames);
  const dealershipName = inspection.dealership?.name ?? 'Dealership';
  const effectiveTranscript =
    transcript.trim() ||
    (framePaths.length > 0
      ? '(Technician recorded video; limited spoken notes.)'
      : '(Video inspection on file; limited spoken notes.)');

  const findings = (inspection.findings ?? [])
    .map(mapFindingDto)
    .map((f) => ({ category: f.category, severity: String(f.severity), note: f.note }));

  let report = '';
  let reportSource: 'grok' | 'fallback' = 'grok';
  try {
    report = await generateCustomerVideoReport({
      transcript: effectiveTranscript,
      transcriptLanguage: inspection.transcriptLanguage,
      vehicleLabel: inspection.vehicleLabel,
      dealershipName,
      title: inspection.title,
      frameDataUrls: [],
      findings,
    });
    if (!report?.trim()) throw new Error('empty report');
  } catch (error) {
    logger.warn('queue.mpi.report_fallback', {
      jobId: msg.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    report = buildFallbackCustomerVideoReport({
      transcript: effectiveTranscript,
      vehicleLabel: inspection.vehicleLabel,
      dealershipName,
      title: inspection.title,
      frameCount: framePaths.length,
      findings,
    });
    reportSource = 'fallback';
  }

  await markAiJobProgress(msg.jobId, 85);

  await withRlsBypass(async () => {
    await getRlsDb().videoInspection.updateMany({
      where: tenantWhere,
      data: {
        status: 'ready',
        reportEncrypted: encryptSensitiveText(report),
        reportPromptVersion:
          reportSource === 'grok'
            ? CUSTOMER_VIDEO_REPORT_PROMPT_VERSION
            : `${CUSTOMER_VIDEO_REPORT_PROMPT_VERSION}+fallback`,
        errorMessage: null,
      },
    });
  });

  return {
    inspectionId,
    reportSource,
    reportPreview: report.slice(0, 280),
  };
}
