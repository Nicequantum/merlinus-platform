import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  assertCanManageMaintenance,
  assertCanSubmitMaintenance,
  findMaintenanceTicketForSession,
  maintenanceTicketInclude,
} from '@/lib/maintenance/access';
import {
  MAINTENANCE_DEPARTMENTS,
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_STATUSES,
} from '@/lib/maintenance/constants';
import { mapMaintenanceTicketDetail } from '@/lib/maintenance/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  severity: z.enum(MAINTENANCE_SEVERITIES).optional(),
  status: z.enum(MAINTENANCE_STATUSES).optional(),
  department: z.enum(MAINTENANCE_DEPARTMENTS).optional(),
  locationLabel: z.string().max(120).nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assignedToId: z.string().max(64).nullable().optional(),
  comment: z.string().max(4000).optional(),
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
      const submit = assertCanSubmitMaintenance(session);
      if (!submit.ok) return apiError(submit.message || FORBIDDEN_ERROR, 403);
      const row = await findMaintenanceTicketForSession(session, routeParams.data.id);
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { ticket: mapMaintenanceTicketDetail(row) };
    },
    {
      rateLimitKey: 'maintenance.get',
      requireDealershipContext: true,
      requireModule: 'maintenance',
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
      const existing = await findMaintenanceTicketForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const managing =
        parsed.data.status !== undefined ||
        parsed.data.assignedToId !== undefined ||
        parsed.data.severity !== undefined ||
        parsed.data.dueAt !== undefined;

      if (managing) {
        const manage = assertCanManageMaintenance(session);
        if (!manage.ok) return apiError(manage.message || FORBIDDEN_ERROR, 403);
      } else {
        const submit = assertCanSubmitMaintenance(session);
        if (!submit.ok) return apiError(submit.message || FORBIDDEN_ERROR, 403);
        // Non-managers may only comment or edit own open tickets' description/title
        if (
          existing.createdById !== session.technicianId &&
          !parsed.data.comment
        ) {
          return apiError(FORBIDDEN_ERROR, 403);
        }
      }

      const data: Record<string, unknown> = {};
      const events: Array<{ type: string; payload: string }> = [];

      if (parsed.data.title !== undefined) data.title = parsed.data.title;
      if (parsed.data.description !== undefined) {
        data.descriptionEncrypted = encryptSensitiveText(parsed.data.description);
      }
      if (parsed.data.department !== undefined) data.department = parsed.data.department;
      if (parsed.data.locationLabel !== undefined) data.locationLabel = parsed.data.locationLabel;
      if (parsed.data.severity !== undefined && parsed.data.severity !== existing.severity) {
        data.severity = parsed.data.severity;
        events.push({
          type: 'severity_changed',
          payload: JSON.stringify({ from: existing.severity, to: parsed.data.severity }),
        });
      }
      if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
        data.status = parsed.data.status;
        if (parsed.data.status === 'done' || parsed.data.status === 'cancelled') {
          data.completedAt = new Date();
        } else if (existing.completedAt) {
          data.completedAt = null;
        }
        events.push({
          type: 'status_changed',
          payload: JSON.stringify({ from: existing.status, to: parsed.data.status }),
        });
      }
      if (parsed.data.assignedToId !== undefined) {
        data.assignedToId = parsed.data.assignedToId;
        events.push({
          type: 'assigned',
          payload: JSON.stringify({ assignedToId: parsed.data.assignedToId }),
        });
      }
      if (parsed.data.dueAt !== undefined) {
        data.dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
      }
      if (parsed.data.comment?.trim()) {
        events.push({ type: 'comment', payload: parsed.data.comment.trim() });
      }

      const row = await getRlsDb().maintenanceTicket.update({
        where: { id: existing.id },
        data: {
          ...data,
          ...(events.length > 0
            ? {
                events: {
                  create: events.map((e) => ({
                    actorId: session.technicianId,
                    type: e.type,
                    payloadEncrypted: encryptSensitiveText(e.payload),
                  })),
                },
              }
            : {}),
        },
        include: maintenanceTicketInclude,
      });

      return { ticket: mapMaintenanceTicketDetail(row) };
    },
    {
      rateLimitKey: 'maintenance.patch',
      requireDealershipContext: true,
      requireModule: 'maintenance',
    }
  );
}
