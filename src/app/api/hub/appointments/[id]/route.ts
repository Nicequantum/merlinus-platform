import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { writeHubAudit } from '@/lib/hub/audit';
import {
  HUB_APPOINTMENT_CATEGORIES,
  HUB_APPOINTMENT_STATUSES,
} from '@/lib/hub/constants';
import { mapAppointmentDto } from '@/lib/hub/mappers';
import { phoneLast4 } from '@/lib/department/piiHelpers';
import { mintShareToken } from '@/lib/hub/share';
import {
  AUTH_JSON_BODY_LIMIT_BYTES,
  parseRequestBody,
  parseRouteParams,
} from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.enum(HUB_APPOINTMENT_CATEGORIES).optional(),
  status: z.enum(HUB_APPOINTMENT_STATUSES).optional(),
  startsAt: z.string().trim().optional(),
  endsAt: z.string().trim().nullable().optional(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(40).optional(),
  vehicleLabel: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(4000).optional(),
  advisorName: z.string().trim().max(120).nullable().optional(),
  /** When true, mint/refresh customer portal share token */
  createShare: z.boolean().optional(),
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
      const row = await getRlsDb().serviceAppointment.findFirst({
        where: { id: routeParams.data.id, dealershipId: session.dealershipId },
      });
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { appointment: mapAppointmentDto(row) };
    },
    {
      rateLimitKey: 'hub.appointments.get',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
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
      const existing = await getRlsDb().serviceAppointment.findFirst({
        where: { id: routeParams.data.id, dealershipId: session.dealershipId },
      });
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data: Record<string, unknown> = {};
      if (parsed.data.title !== undefined) data.title = parsed.data.title;
      if (parsed.data.category !== undefined) data.category = parsed.data.category;
      if (parsed.data.status !== undefined) data.status = parsed.data.status;
      if (parsed.data.startsAt !== undefined) {
        const d = new Date(parsed.data.startsAt);
        if (Number.isNaN(d.getTime())) return apiError('Invalid startsAt', 400);
        data.startsAt = d;
      }
      if (parsed.data.endsAt !== undefined) {
        data.endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
      }
      if (parsed.data.customerName !== undefined) {
        data.customerNameEncrypted = encryptSensitiveText(parsed.data.customerName);
      }
      if (parsed.data.customerPhone !== undefined) {
        data.customerPhoneEncrypted = encryptSensitiveText(parsed.data.customerPhone);
        data.customerPhoneLast4 = phoneLast4(parsed.data.customerPhone);
      }
      if (parsed.data.vehicleLabel !== undefined) data.vehicleLabel = parsed.data.vehicleLabel;
      if (parsed.data.notes !== undefined) {
        data.notesEncrypted = encryptSensitiveText(parsed.data.notes);
      }
      if (parsed.data.advisorName !== undefined) data.advisorName = parsed.data.advisorName;

      let shareRaw: string | undefined;
      if (parsed.data.createShare) {
        const minted = mintShareToken();
        data.shareTokenHash = minted.hash;
        data.shareExpiresAt = new Date(Date.now() + 14 * 24 * 3600_000);
        shareRaw = minted.raw;
      }

      const row = await getRlsDb().serviceAppointment.update({
        where: { id: existing.id },
        data,
      });

      await writeHubAudit({
        dealershipId: session.dealershipId,
        entityType: 'appointment',
        entityId: row.id,
        action: parsed.data.createShare ? 'appointment.share' : 'appointment.update',
        technicianId: session.technicianId,
        metadata: { fields: Object.keys(parsed.data) },
      });

      const host =
        request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
        request.headers.get('host')?.trim() ||
        '';
      const proto =
        request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http'
          ? 'http'
          : 'https';
      const shareUrl =
        shareRaw && host
          ? `${proto}://${host}/portal/${encodeURIComponent(shareRaw)}`
          : shareRaw
            ? `/portal/${encodeURIComponent(shareRaw)}`
            : null;

      return {
        appointment: mapAppointmentDto(row),
        ...(shareUrl ? { shareUrl, shareToken: shareRaw } : {}),
      };
    },
    {
      rateLimitKey: 'hub.appointments.patch',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
  );
}
