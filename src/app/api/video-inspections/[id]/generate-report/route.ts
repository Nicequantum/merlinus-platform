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
import {
  findInspectionForSession,
  resolveVideoDealershipId,
} from '@/lib/videoInspection/access';
import { buildFallbackCustomerVideoReport } from '@/lib/videoInspection/fallbackCustomerReport';
import { fetchPrivateVideoAsBuffer } from '@/lib/videoBlob';
import { CUSTOMER_VIDEO_REPORT_PROMPT_VERSION } from '@/prompts/customerVideoReport/version';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';
import { bufferToVisionDataUrl } from '@/lib/visionImagePrep';
import { logger } from '@/lib/logger';

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
      try {
        const existing = await findInspectionForSession(session, routeParams.data.id);
        if (!existing) return apiError(NOT_FOUND_ERROR, 404);
        if (!existing.videoPathname?.trim()) {
          return apiError('Upload a video before generating a report.', 400);
        }

        const dealershipId = resolveVideoDealershipId(session);
        const db = getRlsDb();

        await db.videoInspection.update({
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
            // frames optional
          }
        }

        const effectiveTranscript =
          transcript.trim() ||
          (frameDataUrls.length > 0
            ? '(Technician recorded video; limited spoken notes.)'
            : '(Video inspection on file; limited spoken notes.)');

        const dealershipName = existing.dealership?.name ?? session.dealershipName;
        let report = '';
        let reportSource: 'grok' | 'fallback' = 'grok';
        let grokError: string | undefined;

        try {
          report = await generateCustomerVideoReport({
            transcript: effectiveTranscript,
            transcriptLanguage: existing.transcriptLanguage,
            vehicleLabel: existing.vehicleLabel,
            dealershipName,
            title: existing.title,
            frameDataUrls,
          });
          if (!report?.trim()) {
            throw new Error('AI returned an empty customer report');
          }
        } catch (error) {
          grokError = error instanceof Error ? error.message : String(error);
          logger.warn('video.report_grok_fallback', {
            inspectionId: existing.id,
            dealershipId,
            error: grokError,
            frameCount: frameDataUrls.length,
            hasTranscript: Boolean(transcript.trim()),
          });
          // Keep pipeline green when Grok key is missing/invalid or xAI is down.
          report = buildFallbackCustomerVideoReport({
            transcript: effectiveTranscript,
            vehicleLabel: existing.vehicleLabel,
            dealershipName,
            title: existing.title,
            frameCount: frameDataUrls.length,
          });
          reportSource = 'fallback';
        }

        const { inspectionInclude } = await import('@/lib/videoInspection/access');
        const row = await db.videoInspection.update({
          where: { id: existing.id },
          data: {
            status: 'ready',
            reportEncrypted: encryptSensitiveText(report),
            reportPromptVersion:
              reportSource === 'grok'
                ? CUSTOMER_VIDEO_REPORT_PROMPT_VERSION
                : `${CUSTOMER_VIDEO_REPORT_PROMPT_VERSION}+fallback`,
            errorMessage: null,
          },
          include: inspectionInclude,
        });

        await writeAuditedAccess({
          action: 'video.report_generate',
          dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'video_inspection',
          entityId: existing.id,
          metadata: {
            promptVersion: CUSTOMER_VIDEO_REPORT_PROMPT_VERSION,
            frameCount: frameDataUrls.length,
            transcriptLanguage: existing.transcriptLanguage,
            hasTranscript: Boolean(transcript.trim()),
            reportSource,
            grokError: grokError?.slice(0, 200),
          },
          ipAddress: getRequestIp(request),
        });

        return {
          inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }),
          reportSource,
          ...(reportSource === 'fallback'
            ? {
                warning:
                  'AI report service was unavailable — a clear template report was saved from the technician notes. Re-run generate when Grok is configured.',
              }
            : {}),
        };
      } catch (error) {
        // Always JSON — never OpenNext HTML 500 for this route
        logger.error('video.report_generate_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          const id = routeParams.data.id;
          await getRlsDb()
            .videoInspection.update({
              where: { id },
              data: {
                status: 'failed',
                errorMessage:
                  error instanceof Error ? error.message.slice(0, 500) : 'Report generation failed',
              },
            })
            .catch(() => undefined);
        } catch {
          // ignore
        }
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
