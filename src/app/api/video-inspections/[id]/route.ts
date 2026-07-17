import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { findInspectionForSession } from '@/lib/videoInspection/access';
import { mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  vehicleLabel: z.string().trim().max(200).nullable().optional(),
  report: z.string().max(20_000).optional(),
  transcript: z.string().max(20_000).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const row = await findInspectionForSession(session, routeParams.data.id);
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
    },
    { rateLimitKey: 'video.get', requireDealershipContext: true }
  );
}

export async function PATCH(
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

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) data.title = parsed.data.title;
      if (parsed.data.vehicleLabel !== undefined) data.vehicleLabel = parsed.data.vehicleLabel;
      if (parsed.data.report !== undefined) {
        data.reportEncrypted = encryptSensitiveText(parsed.data.report);
        if (parsed.data.report.trim()) data.status = existing.status === 'failed' ? 'ready' : existing.status === 'draft' ? 'ready' : existing.status;
      }
      if (parsed.data.transcript !== undefined) {
        data.transcriptEncrypted = encryptSensitiveText(parsed.data.transcript);
      }

      const row = await getRlsDb().videoInspection.update({
        where: { id: existing.id },
        data,
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
        },
      });

      return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
    },
    { rateLimitKey: 'video.patch', requireDealershipContext: true }
  );
}
