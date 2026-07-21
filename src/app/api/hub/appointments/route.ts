import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError } from '@/lib/errors';
import { writeHubAudit } from '@/lib/hub/audit';
import {
  HUB_APPOINTMENT_CATEGORIES,
  HUB_APPOINTMENT_STATUSES,
} from '@/lib/hub/constants';
import { mapAppointmentDto } from '@/lib/hub/mappers';
import { phoneLast4 } from '@/lib/department/piiHelpers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(HUB_APPOINTMENT_CATEGORIES).optional(),
  status: z.enum(HUB_APPOINTMENT_STATUSES).optional(),
  startsAt: z.string().trim().min(8),
  endsAt: z.string().trim().optional().nullable(),
  customerName: z.string().trim().max(120).optional(),
  customerPhone: z.string().trim().max(40).optional(),
  vehicleLabel: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(4000).optional(),
  advisorName: z.string().trim().max(120).optional().nullable(),
  source: z.enum(['manual', 'voice_suggestion', 'hub', 'import']).optional(),
  voiceCallId: z.string().trim().max(64).optional().nullable(),
  departmentRequestId: z.string().trim().max(64).optional().nullable(),
});

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      const where: Record<string, unknown> = { dealershipId: session.dealershipId };
      if (from || to) {
        where.startsAt = {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        };
      }
      const rows = await getRlsDb().serviceAppointment.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        take: 200,
      });
      return { appointments: rows.map((r) => mapAppointmentDto(r)) };
    },
    {
      rateLimitKey: 'hub.appointments.list',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const startsAt = new Date(parsed.data.startsAt);
      if (Number.isNaN(startsAt.getTime())) return apiError('Invalid startsAt', 400);
      const endsAt = parsed.data.endsAt ? new Date(parsed.data.endsAt) : null;
      if (endsAt && Number.isNaN(endsAt.getTime())) return apiError('Invalid endsAt', 400);

      const phone = parsed.data.customerPhone?.trim() || '';
      const row = await getRlsDb().serviceAppointment.create({
        data: {
          dealershipId: session.dealershipId,
          title: parsed.data.title,
          category: parsed.data.category || 'service',
          status: parsed.data.status || 'scheduled',
          startsAt,
          endsAt,
          customerNameEncrypted: encryptSensitiveText(parsed.data.customerName || ''),
          customerPhoneEncrypted: encryptSensitiveText(phone),
          customerPhoneLast4: phoneLast4(phone),
          vehicleLabel: parsed.data.vehicleLabel || null,
          notesEncrypted: encryptSensitiveText(parsed.data.notes || ''),
          advisorName: parsed.data.advisorName || null,
          source: parsed.data.source || 'manual',
          voiceCallId: parsed.data.voiceCallId || null,
          departmentRequestId: parsed.data.departmentRequestId || null,
          createdByTechnicianId: session.technicianId,
        },
      });

      await writeHubAudit({
        dealershipId: session.dealershipId,
        entityType: 'appointment',
        entityId: row.id,
        action: 'appointment.create',
        technicianId: session.technicianId,
        metadata: { title: row.title, startsAt: startsAt.toISOString() },
      });

      return { appointment: mapAppointmentDto(row) };
    },
    {
      rateLimitKey: 'hub.appointments.create',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
  );
}


