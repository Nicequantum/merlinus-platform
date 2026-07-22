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

  await markAiJobProgress(msg.jobId, 15);

  // Delegate to existing generate-report core when available via dynamic import of shared runner.
  // Until fully extracted, mark progress and call Grok report + DB update through access helpers.
  const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
  const { decryptSensitiveText, encryptSensitiveText } = await import('@/lib/encryption');
  const { generateCustomerVideoReport } = await import('@/lib/grok');
  const { buildFallbackCustomerVideoReport } = await import(
    '@/lib/videoInspection/fallbackCustomerReport'
  );
  const { parseFramePathnames } = await import('@/lib/videoInspection/mappers');
  const { CUSTOMER_VIDEO_REPORT_PROMPT_VERSION } = await import(
    '@/prompts/customerVideoReport/version'
  );

  const inspection = await withRlsBypass(async () =>
    getRlsDb().videoInspection.findFirst({
      where: { id: inspectionId, dealershipId: msg.dealershipId },
      include: { dealership: { select: { name: true } } },
    })
  );

  if (!inspection) throw new Error('Video inspection not found');
  if (!inspection.videoPathname?.trim()) {
    throw new Error('Upload a video before generating a report');
  }

  await withRlsBypass(async () => {
    await getRlsDb().videoInspection.updateMany({
      where: { id: inspectionId },
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

  let report = '';
  let reportSource: 'grok' | 'fallback' = 'grok';
  try {
    report = await generateCustomerVideoReport({
      transcript: effectiveTranscript,
      transcriptLanguage: inspection.transcriptLanguage,
      vehicleLabel: inspection.vehicleLabel,
      dealershipName,
      title: inspection.title,
      frameDataUrls: [], // frames optional for async path (reduces payload size)
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
    });
    reportSource = 'fallback';
  }

  await markAiJobProgress(msg.jobId, 85);

  await withRlsBypass(async () => {
    await getRlsDb().videoInspection.updateMany({
      where: { id: inspectionId },
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
