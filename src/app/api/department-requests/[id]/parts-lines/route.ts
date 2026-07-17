import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError, FORBIDDEN_ERROR, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  assertDepartmentInboxAccess,
  departmentRequestInclude,
  findDepartmentRequestForSession,
} from '@/lib/department/access';
import { PARTS_LINE_STATUSES } from '@/lib/department/constants';
import { mapDepartmentRequestDetail, mapPartsLine } from '@/lib/department/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const putSchema = z.object({
  lines: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        partNumber: z.string().max(64).optional().nullable(),
        description: z.string().trim().min(1).max(300),
        qty: z.number().int().min(1).max(999).optional(),
        status: z.enum(PARTS_LINE_STATUSES).optional(),
        quotedPriceCents: z.number().int().min(0).max(100_000_000).optional().nullable(),
        vendor: z.string().max(120).optional().nullable(),
        notes: z.string().max(2000).optional(),
      })
    )
    .max(40),
});

/**
 * PR-M2 — replace parts lines on a parts department request.
 */
export async function PUT(
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
      const access = assertDepartmentInboxAccess(session, 'parts');
      if (!access.ok) return apiError(access.message || FORBIDDEN_ERROR, 403);

      const parsed = await parseRequestBody(request, putSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const db = getRlsDb();
      await db.partsRequestLine.deleteMany({ where: { departmentRequestId: existing.id } });
      if (parsed.data.lines.length > 0) {
        await db.partsRequestLine.createMany({
          data: parsed.data.lines.map((line, i) => ({
            departmentRequestId: existing.id,
            partNumber: line.partNumber?.trim() || null,
            description: line.description.trim(),
            qty: line.qty ?? 1,
            status: line.status || 'requested',
            quotedPriceCents: line.quotedPriceCents ?? null,
            vendor: line.vendor?.trim() || null,
            notesEncrypted: encryptSensitiveText(line.notes?.trim() || ''),
            sortOrder: i,
          })),
        });
      }

      const row = await db.departmentRequest.findFirst({
        where: { id: existing.id },
        include: departmentRequestInclude,
      });
      if (!row) return apiError(NOT_FOUND_ERROR, 404);

      return {
        lines: (row.partsLines ?? []).map(mapPartsLine),
        request: mapDepartmentRequestDetail(row),
      };
    },
    {
      rateLimitKey: 'department.parts_lines.put',
      requireDealershipContext: true,
      requireModule: 'parts',
    }
  );
}
