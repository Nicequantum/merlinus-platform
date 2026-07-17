import { fetchPrivateBlobAsVisionDataUrl } from '@/lib/blob';
import { withAuth } from '@/lib/apiRoute';
import { extractDiagnosticsFromImage } from '@/lib/grok';
import { apiError, FORBIDDEN_ERROR, IMAGE_ACCESS_ERROR, reportMappedRouteError } from '@/lib/errors';
import { mapBlobRouteError, mapGrokRouteError } from '@/lib/scanRouteErrors';
import { userCanAccessImage } from '@/lib/imageAccess';
import { extractPathnameFromImageRef, isAllowedImagePathname } from '@/lib/imageUrls';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeDiagnosticExtractAudit } from '@/lib/diagnosticExtractAudit';
import { logger } from '@/lib/logger';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { imagePathnamesSchema, parseRequestBody } from '@/lib/validation';

/** Must match DIAGNOSTIC_EXTRACT_ROUTE_MAX_DURATION_S in @/lib/timeouts */
export const maxDuration = 100;

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, imagePathnamesSchema);
      if ('error' in parsed) return parsed.error;

      const extractStartedAt = Date.now();
      const pathname =
        extractPathnameFromImageRef(parsed.data.imagePathnames[0]) || parsed.data.imagePathnames[0];

      if (!isAllowedImagePathname(pathname)) {
        logger.warn('diagnostics.extract.invalid_pathname', {
          pathname,
          technicianId: session.technicianId,
        });
        return apiError(FORBIDDEN_ERROR, 403);
      }
      const allowed = await userCanAccessImage(session, pathname);
      if (!allowed) {
        logger.warn('diagnostics.extract.image_access_denied', {
          pathname,
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
        });
        return apiError(IMAGE_ACCESS_ERROR, 403);
      }

      let imageDataUrl: string;
      try {
        // Vision-downscaled payload (same as RO extract) — full-size base64 caused
        // cold-start timeouts and multi-minute hangs on large Xentry screenshots.
        const blobStarted = Date.now();
        imageDataUrl = await fetchPrivateBlobAsVisionDataUrl(pathname);
        logger.info('diagnostics.extract.blob_ready', {
          technicianId: session.technicianId,
          pathname,
          blobMs: Date.now() - blobStarted,
          elapsedMs: Date.now() - extractStartedAt,
        });
      } catch (error) {
        logger.warn('diagnostics.extract.blob_failed', {
          technicianId: session.technicianId,
          pathname,
          elapsedMs: Date.now() - extractStartedAt,
          error: error instanceof Error ? error.message : 'unknown',
        });
        const mapped = mapBlobRouteError(error, 'fetch');
        return reportMappedRouteError(mapped, error, 'diagnostics.extract');
      }

      try {
        const grokStarted = Date.now();
        const extracted = await extractDiagnosticsFromImage(imageDataUrl);
        const durationMs = Date.now() - extractStartedAt;

        await writeDiagnosticExtractAudit({
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          pathname,
          durationMs,
          extracted,
          ipAddress: getRequestIp(request),
        });

        logger.info('diagnostics.extract.success', {
          technicianId: session.technicianId,
          codeCount: extracted.codes?.length ?? 0,
          faultCodeCount: extracted.faultCodes?.length ?? 0,
          durationMs,
          grokMs: Date.now() - grokStarted,
        });
        return extracted;
      } catch (error) {
        logger.warn('diagnostics.extract.grok_failed', {
          technicianId: session.technicianId,
          pathname,
          elapsedMs: Date.now() - extractStartedAt,
          error: error instanceof Error ? error.message : 'unknown',
        });
        const mapped = mapGrokRouteError(error, 'Diagnostic scan');
        return reportMappedRouteError(mapped, error, 'diagnostics.extract');
      }
    },
    {
      rateLimitKey: 'diagnostics.extract',
      rateLimit: RATE_LIMITS.generate,
      trackUsage: true,
      blockInMaintenance: true,
      blockServiceAdvisorAi: true,
      perfEvent: 'route.diagnostics.extract',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}