import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';
import { findInspectionForSession, inspectionInclude } from '@/lib/videoInspection/access';
import {
  mapFindingDto,
  normalizeFindingInput,
  severityAndChecklistFromDtos,
  type FindingInput,
} from '@/lib/videoInspection/findings';
import { mapVideoInspectionDetail } from '@/lib/videoInspection/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody, parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

const findingSchema = z.object({
  category: z.string().trim().min(1).max(64),
  severity: z.enum(['ok', 'recommend', 'urgent']).optional(),
  note: z.string().max(4000).optional(),
  timestampSec: z.number().finite().nullable().optional(),
  framePathname: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const putSchema = z.object({
  findings: z.array(findingSchema).max(40),
});

const VIDEO_MODULE = { requireModule: 'video_mpi' as const };

/**
 * PR-M1a — replace multipoint checklist for an inspection.
 * Replaces all findings, updates severitySummary + mpiChecklistJson.
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
      const existing = await findInspectionForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      const parsed = await parseRequestBody(request, putSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const normalized = parsed.data.findings
        .map((f, i) => normalizeFindingInput(f as FindingInput, i))
        .filter((f): f is NonNullable<typeof f> => f != null);

      if (normalized.length === 0 && parsed.data.findings.length > 0) {
        return apiError(VALIDATION_ERROR, 400);
      }

      const db = getRlsDb();

      await db.videoInspectionFinding.deleteMany({
        where: { videoInspectionId: existing.id },
      });

      if (normalized.length > 0) {
        await db.videoInspectionFinding.createMany({
          data: normalized.map((f) => ({
            videoInspectionId: existing.id,
            category: f.category,
            severity: f.severity,
            noteEncrypted: f.noteEncrypted,
            timestampSec: f.timestampSec,
            framePathname: f.framePathname,
            sortOrder: f.sortOrder,
          })),
        });
      }

      const rows = await db.videoInspectionFinding.findMany({
        where: { videoInspectionId: existing.id },
        orderBy: { sortOrder: 'asc' },
      });
      const dtos = rows.map(mapFindingDto);
      const { severitySummary, mpiChecklistJson } = severityAndChecklistFromDtos(dtos);

      const inspection = await db.videoInspection.update({
        where: { id: existing.id },
        data: { severitySummary, mpiChecklistJson },
        include: inspectionInclude,
      });

      return {
        findings: dtos,
        inspection: mapVideoInspectionDetail(inspection, { includeMediaUrls: true }),
      };
    },
    {
      rateLimitKey: 'video.findings.put',
      requireDealershipContext: true,
      ...VIDEO_MODULE,
    }
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const existing = await findInspectionForSession(session, routeParams.data.id);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);
      const findings = (existing.findings ?? []).map(mapFindingDto);
      return { findings };
    },
    {
      rateLimitKey: 'video.findings.get',
      requireDealershipContext: true,
      ...VIDEO_MODULE,
    }
  );
}
