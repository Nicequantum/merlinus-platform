import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR } from '@/lib/errors';
import { last8OfVin } from '@/lib/department/piiHelpers';
import {
  assertLoanerAccess,
  assertLoanerFleetManage,
} from '@/lib/loaner/access';
import { LOANER_VEHICLE_STATUSES } from '@/lib/loaner/constants';
import { mapLoanerVehicle } from '@/lib/loaner/mappers';
import { listAvailableLoaners, listLoanerVehicles } from '@/lib/loaner/service';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

/**
 * PR-M4 — list fleet (optional ?status=available for agent/dashboard filter).
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const access = assertLoanerAccess(session);
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const url = new URL(request.url);
      const status = url.searchParams.get('status')?.trim() || '';
      const availableOnly = url.searchParams.get('available') === '1';

      if (availableOnly) {
        const vehicles = await listAvailableLoaners(session.dealershipId);
        return { vehicles };
      }

      if (status && (LOANER_VEHICLE_STATUSES as readonly string[]).includes(status)) {
        const vehicles = await listLoanerVehicles(session.dealershipId, {
          status: status as (typeof LOANER_VEHICLE_STATUSES)[number],
        });
        return { vehicles };
      }

      const vehicles = await listLoanerVehicles(session.dealershipId);
      return { vehicles };
    },
    {
      rateLimitKey: 'loaner.vehicles.list',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}

const createSchema = z.object({
  unitNumber: z.string().trim().min(1).max(32),
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

/**
 * PR-M4 — add a unit to the fleet.
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const manage = assertLoanerFleetManage(session);
      if (!manage.ok) return apiError(manage.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const unitNumber = parsed.data.unitNumber.trim().toUpperCase();
      const existing = await getRlsDb().loanerVehicle.findFirst({
        where: { dealershipId: session.dealershipId, unitNumber },
      });
      if (existing) return apiError('A loaner with this unit number already exists', 409);

      const vin = (parsed.data.vin || '').trim().toUpperCase();
      const dealerId = resolveDealerIdForWrite({ session });
      const row = await getRlsDb().loanerVehicle.create({
        data: {
          dealershipId: session.dealershipId,
          dealerId: dealerId ?? null,
          unitNumber,
          vinEncrypted: encryptSensitiveText(vin),
          vinLast8: last8OfVin(vin),
          year: parsed.data.year ?? null,
          make: parsed.data.make?.trim() || null,
          model: parsed.data.model?.trim() || null,
          plateEncrypted: encryptSensitiveText((parsed.data.plate || '').trim().toUpperCase()),
          color: parsed.data.color?.trim() || null,
          odometer: parsed.data.odometer ?? 0,
          status: parsed.data.status || 'available',
          notesEncrypted: encryptSensitiveText((parsed.data.notes || '').trim()),
        },
      });

      return { vehicle: mapLoanerVehicle(row) };
    },
    {
      rateLimitKey: 'loaner.vehicles.create',
      requireDealershipContext: true,
      requireModule: 'loaner',
    }
  );
}
