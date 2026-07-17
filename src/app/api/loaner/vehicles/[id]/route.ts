import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import { last8OfVin } from '@/lib/department/piiHelpers';
import {
  assertLoanerAccess,
  assertLoanerFleetManage,
  findLoanerVehicleForSession,
} from '@/lib/loaner/access';
import { LOANER_VEHICLE_STATUSES } from '@/lib/loaner/constants';
import { mapLoanerVehicle } from '@/lib/loaner/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const patchSchema = z.object({
  unitNumber: z.string().trim().min(1).max(32).optional(),
  vin: z.string().max(32).optional(),
  year: z.number().int().min(1980).max(2100).optional().nullable(),
  make: z.string().max(64).optional().nullable(),
  model: z.string().max(64).optional().nullable(),
  plate: z.string().max(20).optional(),
  color: z.string().max(40).optional().nullable(),
  odometer: z.number().int().min(0).max(2_000_000).optional(),
  status: z.enum(LOANER_VEHICLE_STATUSES).optional(),
  notes: z.string().max(4000).optional(),
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
      const row = await findLoanerVehicleForSession(session, routeParams.data.id);
      if (!row) return apiError(NOT_FOUND_ERROR, 404);
      return { vehicle: mapLoanerVehicle(row) };
    },
    {
      rateLimitKey: 'loaner.vehicles.get',
      requireDealershipContext: true,
      requireModule: 'loaner',
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
      const manage = assertLoanerFleetManage(session);
      if (!manage.ok) return apiError(manage.message || FORBIDDEN_ERROR, 403);

      const existing = await findLoanerVehicleForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const parsed = await parseRequestBody(request, patchSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const data: Record<string, unknown> = {};
      if (parsed.data.unitNumber !== undefined) {
        data.unitNumber = parsed.data.unitNumber.trim().toUpperCase();
      }
      if (parsed.data.vin !== undefined) {
        const vin = parsed.data.vin.trim().toUpperCase();
        data.vinEncrypted = encryptSensitiveText(vin);
        data.vinLast8 = last8OfVin(vin);
      }
      if (parsed.data.year !== undefined) data.year = parsed.data.year;
      if (parsed.data.make !== undefined) data.make = parsed.data.make;
      if (parsed.data.model !== undefined) data.model = parsed.data.model;
      if (parsed.data.plate !== undefined) {
        data.plateEncrypted = encryptSensitiveText(parsed.data.plate.trim().toUpperCase());
      }
      if (parsed.data.color !== undefined) data.color = parsed.data.color;
      if (parsed.data.odometer !== undefined) data.odometer = parsed.data.odometer;
      if (parsed.data.status !== undefined) data.status = parsed.data.status;
      if (parsed.data.notes !== undefined) {
        data.notesEncrypted = encryptSensitiveText(parsed.data.notes);
      }

      const row = await getRlsDb().loanerVehicle.update({
        where: { id: existing.id },
        data,
      });
      return { vehicle: mapLoanerVehicle(row) };
    },
    {
      rateLimitKey: 'loaner.vehicles.patch',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}
