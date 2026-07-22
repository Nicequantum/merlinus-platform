/**
 * GET history / POST reset / POST restore for a department's tailoring.
 */
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import {
  isTailoringDepartment,
  listCustomizationVersions,
  resetDepartmentCustomization,
  restoreCustomizationVersion,
  getDepartmentCustomization,
  type TailoringDepartment,
} from '@/lib/voiceAgent/customization';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({
  department: z.string().trim().min(1).max(32),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ department: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  if (!isTailoringDepartment(routeParams.data.department)) {
    return apiError('Unknown department', 400);
  }
  const department = routeParams.data.department as TailoringDepartment;

  return withAuth(
    request,
    async (session) => {
      const [customization, versions] = await Promise.all([
        getDepartmentCustomization(session.dealershipId, department),
        listCustomizationVersions(session.dealershipId, department, 25),
      ]);
      return { customization, versions };
    },
    {
      rateLimitKey: 'voice.customizations.history',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset') }),
  z.object({
    action: z.literal('restore'),
    version: z.number().int().min(1).max(10_000),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ department: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  if (!isTailoringDepartment(routeParams.data.department)) {
    return apiError('Unknown department', 400);
  }
  const department = routeParams.data.department as TailoringDepartment;

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, actionSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        if (parsed.data.action === 'reset') {
          const customization = await resetDepartmentCustomization({
            dealershipId: session.dealershipId,
            department,
            actorTechnicianId: session.technicianId,
          });
          return { ok: true, customization };
        }
        const customization = await restoreCustomizationVersion({
          dealershipId: session.dealershipId,
          department,
          version: parsed.data.version,
          actorTechnicianId: session.technicianId,
        });
        return { ok: true, customization };
      } catch (error) {
        return apiError(error instanceof Error ? error.message : String(error), 400);
      }
    },
    {
      rateLimitKey: 'voice.customizations.action',
      rateLimit: RATE_LIMITS.authMfa,
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
