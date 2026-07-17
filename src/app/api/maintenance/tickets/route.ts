import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import {
  assertCanSubmitMaintenance,
  maintenanceTicketInclude,
} from '@/lib/maintenance/access';
import {
  MAINTENANCE_DEPARTMENTS,
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_STATUSES,
} from '@/lib/maintenance/constants';
import {
  mapMaintenanceTicketDetail,
  mapMaintenanceTicketSummary,
} from '@/lib/maintenance/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000).optional(),
  severity: z.enum(MAINTENANCE_SEVERITIES).optional(),
  department: z.enum(MAINTENANCE_DEPARTMENTS).optional(),
  locationLabel: z.string().max(120).optional(),
  dueAt: z.string().datetime().optional().nullable(),
  assignedToId: z.string().max(64).optional().nullable(),
});

/**
 * PR-M3 — list maintenance tickets for the active rooftop.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const submit = assertCanSubmitMaintenance(session);
      if (!submit.ok) return apiError(submit.message || FORBIDDEN_ERROR, 403);

      const url = new URL(request.url);
      const status = url.searchParams.get('status')?.trim() || '';
      const severity = url.searchParams.get('severity')?.trim() || '';
      const department = url.searchParams.get('department')?.trim() || '';

      const rows = await getRlsDb().maintenanceTicket.findMany({
        where: {
          dealershipId: session.dealershipId,
          ...(status && (MAINTENANCE_STATUSES as readonly string[]).includes(status)
            ? { status: status as (typeof MAINTENANCE_STATUSES)[number] }
            : {}),
          ...(severity && (MAINTENANCE_SEVERITIES as readonly string[]).includes(severity)
            ? { severity: severity as (typeof MAINTENANCE_SEVERITIES)[number] }
            : {}),
          ...(department && (MAINTENANCE_DEPARTMENTS as readonly string[]).includes(department)
            ? { department }
            : {}),
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        take: 200,
        include: {
          createdBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
          photos: { select: { id: true } },
        },
      });

      return {
        tickets: rows.map((row) =>
          mapMaintenanceTicketSummary({
            ...row,
            photos: row.photos.map((p) => ({
              id: p.id,
              pathname: '',
              contentType: 'image/jpeg',
              createdAt: row.createdAt,
            })),
          })
        ),
      };
    },
    {
      rateLimitKey: 'maintenance.list',
      requireDealershipContext: true,
      requireModule: 'maintenance',
    }
  );
}

/**
 * PR-M3 — quick ticket submission (cross-department).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const submit = assertCanSubmitMaintenance(session);
      if (!submit.ok) return apiError(submit.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const dealerId = resolveDealerIdForWrite({ session });
      const dueAt =
        parsed.data.dueAt === null
          ? null
          : parsed.data.dueAt
            ? new Date(parsed.data.dueAt)
            : null;

      const row = await getRlsDb().maintenanceTicket.create({
        data: {
          dealershipId: session.dealershipId,
          dealerId: dealerId ?? null,
          createdById: session.technicianId,
          assignedToId: parsed.data.assignedToId?.trim() || null,
          department: parsed.data.department || 'facilities',
          title: parsed.data.title.trim(),
          descriptionEncrypted: encryptSensitiveText(parsed.data.description?.trim() || ''),
          severity: parsed.data.severity || 'medium',
          status: 'submitted',
          locationLabel: parsed.data.locationLabel?.trim() || null,
          dueAt,
          events: {
            create: {
              actorId: session.technicianId,
              type: 'created',
              payloadEncrypted: encryptSensitiveText(
                JSON.stringify({ title: parsed.data.title.trim() })
              ),
            },
          },
        },
        include: maintenanceTicketInclude,
      });

      return { ticket: mapMaintenanceTicketDetail(row) };
    },
    {
      rateLimitKey: 'maintenance.create',
      requireDealershipContext: true,
      requireModule: 'maintenance',
    }
  );
}
