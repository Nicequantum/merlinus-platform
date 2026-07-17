import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR, reportMappedRouteError } from '@/lib/errors';
import { generateCustomerVideoReport } from '@/lib/grok';
import { mapGrokRouteError } from '@/lib/grokErrors';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { parseFramePathnames, mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import { findInspectionForSession } from '@/lib/videoInspection/access';
import { fetchPrivateVideoAsBuffer } from '@/lib/videoBlob';
import { CUSTOMER_VIDEO_REPORT_PROMPT_VERSION } from '@/prompts/customerVideoReport/version';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';
import { bufferToVisionDataUrl } from '@/lib/visionImagePrep';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

/** Sync with CUSTOMER_VIDEO_REPORT_ROUTE_MAX_DURATION_S in timeouts.ts */
export const maxDuration = 130;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findInspectionForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      if (!existing.videoPathname?.trim()) {
        return apiError('Upload a video before generating a report.', 400);
      }

      await getRlsDb().videoInspection.update({
        where: { id: existing.id },
        data: { status: 'processing', errorMessage: null },
      });

      const transcript = decryptSensitiveText(existing.transcriptEncrypted || '');
      const framePaths = parseFramePathnames(existing.framePathnames);
      const frameDataUrls: string[] = [];

      for (const path of framePaths.slice(0, 8)) {
        try {
          const buf = await fetchPrivateVideoAsBuffer(path);
          frameDataUrls.push(await bufferToVisionDataUrl(buf, 'image/jpeg'));
        } catch {
          // skip frame
        }
      }

      try {
        const report = await generateCustomerVideoReport({
          transcript,
          transcriptLanguage: existing.transcriptLanguage,
          vehicleLabel: existing.vehicleLabel,
          dealershipName: existing.dealership?.name ?? session.dealershipName,
          title: existing.title,
          frameDataUrls,
        });

        const { inspectionInclude } = await import('@/lib/videoInspection/access');
        const row = await getRlsDb().videoInspection.update({
          where: { id: existing.id },
          data: {
            status: 'ready',
            reportEncrypted: encryptSensitiveText(report),
            reportPromptVersion: CUSTOMER_VIDEO_REPORT_PROMPT_VERSION,
            errorMessage: null,
          },
          include: inspectionInclude,
        });

        await writeAuditedAccess({
          action: 'video.report_generate',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'video_inspection',
          entityId: existing.id,
          metadata: {
            promptVersion: CUSTOMER_VIDEO_REPORT_PROMPT_VERSION,
            frameCount: frameDataUrls.length,
            transcriptLanguage: existing.transcriptLanguage,
          },
          ipAddress: getRequestIp(request),
        });

        return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
      } catch (error) {
        await getRlsDb()
          .videoInspection.update({
            where: { id: existing.id },
            data: {
              status: 'failed',
              errorMessage:
                error instanceof Error ? error.message.slice(0, 500) : 'Report generation failed',
            },
          })
          .catch(() => undefined);

        const mapped = mapGrokRouteError(error, 'Customer video report');
        return reportMappedRouteError(mapped, error, 'video.report_generate');
      }
    },
    {
      rateLimitKey: 'video.generate_report',
      rateLimit: RATE_LIMITS.generate,
      requireDealershipContext: true,
      blockInMaintenance: true,
      trackUsage: true,
      requireModule: 'video_mpi',
    }
  );
}
