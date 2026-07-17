import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import { assertLoanerAccess, loanerAssignmentInclude } from '@/lib/loaner/access';
import { LOANER_ASSIGNMENT_STATUSES } from '@/lib/loaner/constants';
import { mapLoanerAssignment } from '@/lib/loaner/mappers';
import { createLoanerReservation, type DamageMark } from '@/lib/loaner/service';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const damageSchema = z.object({
  area: z.string().trim().min(1).max(80),
  note: z.string().max(400).optional(),
  severity: z.enum(['minor', 'major']).optional(),
});

/**
 * PR-M4 — list assignments (optional status filter).
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const access = assertLoanerAccess(session);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const url = new URL(request.url);
      const status = url.searchParams.get('status')?.trim() || '';
      const openOnly = url.searchParams.get('open') === '1';

      const rows = await getRlsDb().loanerAssignment.findMany({
        where: {
          dealershipId: session.dealershipId,
          ...(openOnly
            ? { status: { in: ['reserved', 'active'] } }
            : status && (LOANER_ASSIGNMENT_STATUSES as readonly string[]).includes(status)
              ? { status: status as (typeof LOANER_ASSIGNMENT_STATUSES)[number] }
              : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: loanerAssignmentInclude,
      });

      return { assignments: rows.map(mapLoanerAssignment) };
    },
    {
      rateLimitKey: 'loaner.assignments.list',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}

const createSchema = z.object({
  loanerVehicleId: z.string().trim().min(1).max(64),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(40).optional(),
  dueBackAt: z.string().datetime().optional().nullable(),
  repairOrderId: z.string().max(64).optional().nullable(),
  departmentRequestId: z.string().max(64).optional().nullable(),
  notes: z.string().max(4000).optional(),
  mode: z.enum(['reserve', 'checkout']).optional(),
  outOdometer: z.number().int().min(0).max(2_000_000).optional().nullable(),
  fuelOut: z.string().max(16).optional().nullable(),
  damageOut: z.array(damageSchema).max(40).optional(),
});

/**
 * PR-M4 — reserve or check out a loaner (also the agent entrypoint).
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const access = assertLoanerAccess(session);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        const assignment = await createLoanerReservation({
          dealershipId: session.dealershipId,
          dealerId: resolveDealerIdForWrite({ session }),
          loanerVehicleId: parsed.data.loanerVehicleId,
          customerName: parsed.data.customerName,
          customerPhone: parsed.data.customerPhone,
          dueBackAt: parsed.data.dueBackAt ? new Date(parsed.data.dueBackAt) : null,
          repairOrderId: parsed.data.repairOrderId,
          departmentRequestId: parsed.data.departmentRequestId,
          notes: parsed.data.notes,
          createdById: session.technicianId,
          mode: parsed.data.mode || 'reserve',
          outOdometer: parsed.data.outOdometer,
          fuelOut: parsed.data.fuelOut,
          damageOut: parsed.data.damageOut as DamageMark[] | undefined,
        });
        return { assignment };
      } catch (error) {
        const code = error instanceof Error ? error.message : 'LOANER_ERROR';
        if (code === 'LOANER_VEHICLE_NOT_FOUND') return apiError('Loaner vehicle not found', 404);
        if (code === 'LOANER_VEHICLE_NOT_AVAILABLE') {
          return apiError('That loaner is not available for reservation', 409);
        }
        throw error;
      }
    },
    {
      rateLimitKey: 'loaner.assignments.create',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}
