import { withAuth } from '@/lib/apiRoute';
import { getAiJobForDealership, getAiJobForTechnician } from '@/lib/aiJobs/service';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { luxuryPhaseFromProgress } from '@/lib/queue/jobEventsHub';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

const paramsSchema = z.object({ jobId: z.string().trim().min(1).max(64) });

/**
 * Poll durable AI job status (alias of /api/ai-jobs/[id] for queue clients).
 * Luxury phase: Queued → Processing → AI Thinking → Complete.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;

  return withAuth(
    request,
    async (session) => {
      const isManager =
        session.role === 'manager' || session.isAdmin || session.role === 'owner';
      const job = isManager
        ? await getAiJobForDealership(routeParams.data.jobId, session.dealershipId)
        : await getAiJobForTechnician(routeParams.data.jobId, session.technicianId);
      if (!job) return apiError(NOT_FOUND_ERROR, 404);

      const phase =
        job.phase || luxuryPhaseFromProgress(job.status, job.progress);

      return {
        jobId: job.id,
        phase,
        status: job.status,
        progress: job.progress,
        kind: job.kind,
        errorMessage: job.errorMessage,
        result: job.result,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        createdAt: job.createdAt,
        technicianId: job.technicianId,
        entityType: job.entityType,
        entityId: job.entityId,
        pollUrl: `/api/queue/job-status/${job.id}`,
        eventsUrl: `/api/queue/job-events/${job.id}`,
      };
    },
    {
      rateLimitKey: 'queue.job_status',
      requireDealershipContext: true,
    }
  );
}
