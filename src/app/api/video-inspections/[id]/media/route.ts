import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { findInspectionForSession } from '@/lib/videoInspection/access';
import { isAllowedVideoPathname, streamPrivateVideoBlob } from '@/lib/videoBlob';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const row = await findInspectionForSession(session, routeParams.data.id);
      if (!row?.videoPathname || !isAllowedVideoPathname(row.videoPathname)) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      try {
        const result = await streamPrivateVideoBlob(row.videoPathname);
        if (!result) return apiError(NOT_FOUND_ERROR, 404);
        return new Response(result.stream, {
          status: 200,
          headers: {
            'Content-Type': row.contentType || result.blob.contentType || 'video/webm',
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'inline',
          },
        });
      } catch {
        return apiError(NOT_FOUND_ERROR, 404);
      }
    },
    { rateLimitKey: 'video.media', requireDealershipContext: true }
  );
}
