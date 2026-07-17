import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { findInspectionForSession, inspectionInclude } from '@/lib/videoInspection/access';
import { mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import { last8OfVin, phoneLast4 } from '@/lib/videoInspection/mpiCategories';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  title: z.string().trim().max(200).optional(),
  vehicleLabel: z.string().trim().max(200).nullable().optional(),
  report: z.string().max(20_000).optional(),
  transcript: z.string().max(20_000).optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  vin: z.string().max(32).optional(),
  recordingMode: z.enum(['fullscreen', 'standard', 'upload']).optional(),
  status: z.enum(['draft', 'processing', 'ready', 'failed', 'sent']).optional(),
  deliveryChannel: z.enum(['sms', 'email', 'link']).nullable().optional(),
});

const VIDEO_MODULE = { requireModule: 'video_mpi' as const };

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
    { rateLimitKey: 'video.get', requireDealershipContext: true, ...VIDEO_MODULE }
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
        if (parsed.data.report.trim()) {
          data.status =
            existing.status === 'failed'
              ? 'ready'
              : existing.status === 'draft'
                ? 'ready'
                : existing.status;
        }
      }
      if (parsed.data.transcript !== undefined) {
        data.transcriptEncrypted = encryptSensitiveText(parsed.data.transcript);
      }
      if (parsed.data.customerName !== undefined) {
        data.customerNameEncrypted = encryptSensitiveText(parsed.data.customerName.trim());
      }
      if (parsed.data.customerPhone !== undefined) {
        const phone = parsed.data.customerPhone.trim();
        data.customerPhoneEncrypted = encryptSensitiveText(phone);
        data.customerPhoneLast4 = phoneLast4(phone);
      }
      if (parsed.data.vin !== undefined) {
        const vin = parsed.data.vin.trim().toUpperCase();
        data.vinEncrypted = encryptSensitiveText(vin);
        data.vinLast8 = last8OfVin(vin);
      }
      if (parsed.data.recordingMode !== undefined) data.recordingMode = parsed.data.recordingMode;
      if (parsed.data.status !== undefined) data.status = parsed.data.status;
      if (parsed.data.deliveryChannel !== undefined) {
        data.deliveryChannel = parsed.data.deliveryChannel;
        if (parsed.data.deliveryChannel) {
          data.deliveredAt = new Date();
          if (existing.status !== 'failed') data.status = 'sent';
        }
      }

      const row = await getRlsDb().videoInspection.update({
        where: { id: existing.id },
        data,
        include: inspectionInclude,
      });

      return { inspection: mapVideoInspectionDetail(row, { includeMediaUrls: true }) };
    },
    { rateLimitKey: 'video.patch', requireDealershipContext: true, ...VIDEO_MODULE }
  );
}
