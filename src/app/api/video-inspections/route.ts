import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { canListAllInspections } from '@/lib/videoInspection/access';
import { mapVideoInspectionListItem } from '@/lib/videoInspection/mappers';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  vehicleLabel: z.string().trim().max(200).optional(),
  repairOrderId: z.string().trim().max(64).optional(),
  repairLineId: z.string().trim().max(64).optional(),
});

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const db = getRlsDb();
      const rows = await db.videoInspection.findMany({
        where: {
          dealershipId: session.dealershipId,
          ...(canListAllInspections(session) ? {} : { technicianId: session.technicianId }),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
        },
      });
      return { inspections: rows.map(mapVideoInspectionListItem) };
    },
    {
      rateLimitKey: 'video.list',
      requireDealershipContext: true,
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const dealerId = resolveDealerIdForWrite({ session });
      const row = await getRlsDb().videoInspection.create({
        data: {
          dealershipId: session.dealershipId,
          dealerId: dealerId ?? null,
          technicianId: session.technicianId,
          title: parsed.data.title?.trim() || 'Video inspection',
          vehicleLabel: parsed.data.vehicleLabel?.trim() || null,
          repairOrderId: parsed.data.repairOrderId?.trim() || null,
          repairLineId: parsed.data.repairLineId?.trim() || null,
          status: 'draft',
          transcriptLanguage: session.preferredLanguage || 'en',
        },
        include: {
          technician: { select: { name: true } },
          dealership: { select: { name: true } },
        },
      });

      return { inspection: mapVideoInspectionListItem(row) };
    },
    {
      rateLimitKey: 'video.create',
      requireDealershipContext: true,
    }
  );
}
