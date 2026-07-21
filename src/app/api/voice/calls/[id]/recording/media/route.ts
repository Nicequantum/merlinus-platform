import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getObject } from '@/lib/storage/objectStorage';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * Authenticated stream of a stored voice call recording (private R2).
 * Used by the Unified Hub timeline player.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const call = await getRlsDb().voiceCall.findFirst({
        where: { id: routeParams.data.id, dealershipId: session.dealershipId },
        select: {
          recordingPathname: true,
          recordingStatus: true,
        },
      });
      if (!call?.recordingPathname) return apiError(NOT_FOUND_ERROR, 404);
      if (!call.recordingPathname.startsWith('benz-tech/voice-recording/')) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      try {
        const obj = await getObject(call.recordingPathname);
        if (!obj) return apiError(NOT_FOUND_ERROR, 404);
        return new Response(obj.stream, {
          status: 200,
          headers: {
            'Content-Type': obj.contentType || 'audio/mpeg',
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'inline',
          },
        });
      } catch {
        return apiError(NOT_FOUND_ERROR, 404);
      }
    },
    {
      rateLimitKey: 'voice.recording.media',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}
