import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import {
  canListAllInspections,
  resolveRepairOrderLink,
  resolveVideoDealershipId,
} from '@/lib/videoInspection/access';
import { mapVideoInspectionListItem } from '@/lib/videoInspection/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  vehicleLabel: z.string().trim().max(200).optional(),
  repairOrderId: z.string().trim().max(64).optional(),
  repairLineId: z.string().trim().max(64).optional(),
});

const VIDEO_MODULE = { requireModule: 'video_mpi' as const };

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const db = getRlsDb();
      const dealershipId = resolveVideoDealershipId(session);
      const url = new URL(request.url);
      const statusFilter = url.searchParams.get('status')?.trim() || '';
      const repairOrderId = url.searchParams.get('repairOrderId')?.trim() || '';
      const rows = await db.videoInspection.findMany({
        where: {
          dealershipId,
          ...(canListAllInspections(session) ? {} : { technicianId: session.technicianId }),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(repairOrderId ? { repairOrderId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
          findings: {
            select: {
              id: true,
              severity: true,
              sortOrder: true,
              category: true,
              noteEncrypted: true,
              timestampSec: true,
              framePathname: true,
            },
          },
        },
      });
      return { inspections: rows.map(mapVideoInspectionListItem) };
    },
    {
      rateLimitKey: 'video.list',
      requireDealershipContext: true,
      ...VIDEO_MODULE,
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      let link: { repairOrderId: string | null; repairLineId: string | null };
      try {
        link = await resolveRepairOrderLink(
          session,
          parsed.data.repairOrderId,
          parsed.data.repairLineId
        );
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Invalid repair order', 400);
      }

      const dealerId = resolveDealerIdForWrite({ session });
      const dealershipId = resolveVideoDealershipId(session);
      const row = await getRlsDb().videoInspection.create({
        data: {
          dealershipId,
          dealerId: dealerId ?? null,
          technicianId: session.technicianId,
          title: parsed.data.title?.trim() || 'Video inspection',
          vehicleLabel: parsed.data.vehicleLabel?.trim() || null,
          repairOrderId: link.repairOrderId,
          repairLineId: link.repairLineId,
          status: 'draft',
          transcriptLanguage: session.preferredLanguage || 'en',
          recordingMode: 'standard',
        },
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
          findings: true,
        },
      });

      return { inspection: mapVideoInspectionListItem(row) };
    },
    {
      rateLimitKey: 'video.create',
      requireDealershipContext: true,
      ...VIDEO_MODULE,
    }
  );
}
