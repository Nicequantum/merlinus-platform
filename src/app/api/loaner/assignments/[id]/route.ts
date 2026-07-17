import { withAuth } from '@/lib/apiRoute';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  assertLoanerAccess,
  findLoanerAssignmentForSession,
} from '@/lib/loaner/access';
import { mapLoanerAssignment } from '@/lib/loaner/mappers';
import {
  checkoutLoanerAssignment,
  returnLoanerAssignment,
  type DamageMark,
} from '@/lib/loaner/service';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const damageSchema = z.object({
  area: z.string().trim().min(1).max(80),
  note: z.string().max(400).optional(),
  severity: z.enum(['minor', 'major']).optional(),
});

const patchSchema = z.object({
  action: z.enum(['checkout', 'return', 'cancel']),
  outOdometer: z.number().int().min(0).max(2_000_000).optional().nullable(),
  inOdometer: z.number().int().min(0).max(2_000_000).optional().nullable(),
  fuelOut: z.string().max(16).optional().nullable(),
  fuelIn: z.string().max(16).optional().nullable(),
  damageOut: z.array(damageSchema).max(40).optional(),
  damageIn: z.array(damageSchema).max(40).optional(),
  markVehicleStatus: z.enum(['available', 'maintenance', 'out_of_service']).optional(),
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
      const access = assertLoanerAccess(session);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);
      const row = await findLoanerAssignmentForSession(session, routeParams.data.id);
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { assignment: mapLoanerAssignment(row) };
    },
    {
      rateLimitKey: 'loaner.assignments.get',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}

/**
 * PR-M4 — checkout / return / cancel lifecycle.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const access = assertLoanerAccess(session);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        if (parsed.data.action === 'checkout') {
          const assignment = await checkoutLoanerAssignment({
            dealershipId: session.dealershipId,
            assignmentId: routeParams.data.id,
            outOdometer: parsed.data.outOdometer,
            fuelOut: parsed.data.fuelOut,
            damageOut: parsed.data.damageOut as DamageMark[] | undefined,
          });
          return { assignment };
        }

        if (parsed.data.action === 'return') {
          const assignment = await returnLoanerAssignment({
            dealershipId: session.dealershipId,
            assignmentId: routeParams.data.id,
            inOdometer: parsed.data.inOdometer,
            fuelIn: parsed.data.fuelIn,
            damageIn: parsed.data.damageIn as DamageMark[] | undefined,
            markVehicleStatus: parsed.data.markVehicleStatus,
          });
          return { assignment };
        }

        // cancel reservation
        const existing = await findLoanerAssignmentForSession(session, routeParams.data.id);
        if (!existing) return apiError(NOT_FOUND_ERROR, 404);
        if (existing.status !== 'reserved') {
          return apiError('Only reserved assignments can be cancelled', 409);
        }
        const { getRlsDb } = await import('@/lib/apex/rlsContext');
        const db = getRlsDb();
        const updated = await db.loanerAssignment.update({
          where: { id: existing.id },
          data: { status: 'cancelled' },
          include: {
            loanerVehicle: {
              select: {
                id: true,
                unitNumber: true,
                year: true,
                make: true,
                model: true,
                status: true,
                color: true,
                odometer: true,
              },
            },
            createdBy: { select: { name: true } },
          },
        });
        await db.loanerVehicle.update({
          where: { id: existing.loanerVehicleId },
          data: { status: 'available' },
        });
        return { assignment: mapLoanerAssignment(updated) };
      } catch (error) {
        const code = error instanceof Error ? error.message : 'LOANER_ERROR';
        if (code === 'LOANER_ASSIGNMENT_NOT_FOUND') return apiError(NOT_FOUND_ERROR, 404);
        if (code === 'LOANER_ASSIGNMENT_NOT_RESERVED') {
          return apiError('Assignment is not in reserved status', 409);
        }
        if (code === 'LOANER_ASSIGNMENT_NOT_OPEN') {
          return apiError('Assignment is not open for return', 409);
        }
        throw error;
      }
    },
    {
      rateLimitKey: 'loaner.assignments.patch',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}
