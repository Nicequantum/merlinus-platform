import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  parseQueryParams,
  parseRouteParams,
  routeIdParamsSchema,
  technicianStoriesQuerySchema,
} from '@/lib/validation';

function decodeStoryCursor(cursor: string): { certifiedAt: Date; id: string } | null {
  const separator = cursor.lastIndexOf('|');
  if (separator <= 0) return null;
  const iso = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (!iso || !id) return null;
  const certifiedAt = new Date(iso);
  if (Number.isNaN(certifiedAt.getTime())) return null;
  return { certifiedAt, id };
}

function encodeStoryCursor(certifiedAt: Date, id: string): string {
  return `${certifiedAt.toISOString()}|${id}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  const query = parseQueryParams(request, technicianStoriesQuerySchema);
  if ('error' in query) return query.error;
  const { limit, cursor } = query.data;
  const cursorDecoded = cursor ? decodeStoryCursor(cursor) : null;
  if (cursor && !cursorDecoded) {
    return apiError('Invalid cursor.', 400);
  }

  return withAuth(
    request,
    async (session) => {
      const technician = await getRlsDb().technician.findFirst({
        where: { id, dealershipId: session.dealershipId, deletedAt: null },
        select: { id: true },
      });

      if (!technician) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const stories = await getRlsDb().technicianCertifiedStory.findMany({
        where: {
          technicianId: id,
          dealershipId: session.dealershipId,
          ...(cursorDecoded
            ? {
                OR: [
                  { certifiedAt: { lt: cursorDecoded.certifiedAt } },
                  { certifiedAt: cursorDecoded.certifiedAt, id: { lt: cursorDecoded.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ certifiedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: {
          id: true,
          repairOrderId: true,
          repairLineId: true,
          roNumber: true,
          lineNumber: true,
          certifiedAt: true,
          certifiedByName: true,
          promptVersion: true,
        },
      });

      const hasMore = stories.length > limit;
      const page = hasMore ? stories.slice(0, limit) : stories;
      const last = page[page.length - 1];

      return {
        stories: page.map((story) => ({
          id: story.id,
          repairOrderId: story.repairOrderId,
          repairLineId: story.repairLineId,
          roNumber: story.roNumber,
          lineNumber: story.lineNumber,
          certifiedAt: story.certifiedAt.toISOString(),
          certifiedByName: story.certifiedByName,
          promptVersion: story.promptVersion,
        })),
        nextCursor: hasMore && last ? encodeStoryCursor(last.certifiedAt, last.id) : null,
      };
    },
    { rateLimitKey: 'technicians.stories', requireManager: true }
  );
}