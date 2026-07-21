import { withAuth } from '@/lib/apiRoute';
import { getAiJobForTechnician } from '@/lib/aiJobs/service';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * P1-1 — Poll async AI job status (tenant + technician scoped).
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
      const job = await getAiJobForTechnician(routeParams.data.id, session.technicianId);
      if (!job) return apiError(NOT_FOUND_ERROR, 404);
      return { job };
    },
    {
      rateLimitKey: 'ai-jobs.get',
      requireDealershipContext: true,
    }
  );
}
