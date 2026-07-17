import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  assertDepartmentInboxAccess,
  findDepartmentRequestForSession,
} from '@/lib/department/access';
import { assertDepartmentModuleEnabled } from '@/lib/department/moduleGate';
import { mapPartsLookup } from '@/lib/department/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const postSchema = z.object({
  query: z.string().trim().min(1).max(300),
  result: z.record(z.string(), z.unknown()).optional(),
  source: z.enum(['staff', 'voice', 'cdk']).optional(),
});

/**
 * PR-M2 — append a parts lookup history event to a request.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findDepartmentRequestForSession(session, routeParams.data.id, 'parts');
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      const mod = await assertDepartmentModuleEnabled(session.dealershipId, 'parts');
      if (!mod.ok) return apiError(mod.message, 403);
      const access = assertDepartmentInboxAccess(session, 'parts');
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, postSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const row = await getRlsDb().partsLookupEvent.create({
        data: {
          dealershipId: session.dealershipId,
          departmentRequestId: existing.id,
          query: parsed.data.query,
          resultJson: JSON.stringify(parsed.data.result || {}),
          source: parsed.data.source || 'staff',
          createdById: session.technicianId,
        },
        include: { createdBy: { select: { name: true } } },
      });

      return { lookup: mapPartsLookup(row) };
    },
    {
      rateLimitKey: 'department.lookups.post',
      requireDealershipContext: true,
    }
  );
}
