/**
 * Manager — manually re-enqueue a failed/cancelled durable AI job.
 */
import { withAuth } from '@/lib/apiRoute';
import { getAiJobForDealership } from '@/lib/aiJobs/service';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { retryDurableAiJob } from '@/lib/queue/aiJobs';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ jobId: z.string().trim().min(1).max(64) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const jobId = routeParams.data.jobId;

  return withAuth(
    request,
    async (session) => {
      const existing = await getAiJobForDealership(jobId, session.dealershipId);
      if (!existing) return apiError(NOT_FOUND_ERROR, 404);

      try {
        const result = await retryDurableAiJob({
          jobId,
          dealershipId: session.dealershipId,
          actorUserId: session.technicianId,
        });

        try {
          await writeAuditedAccess({
            action: 'story.generate',
            dealershipId: session.dealershipId,
            technicianId: session.technicianId,
            entityType: 'aiJob',
            entityId: result.jobId,
            metadata: {
              aiQueue: true,
              outcome: 'retried_by_manager',
              previousJobId: jobId,
              transport: result.transport,
              originalKind: existing.kind,
            },
          });
        } catch {
          // audit best-effort
        }

        return {
          ok: true,
          previousJobId: jobId,
          jobId: result.jobId,
          transport: result.transport,
          status: result.status,
          pollUrl: `/api/queue/job-status/${result.jobId}`,
          eventsUrl: `/api/queue/job-events/${result.jobId}`,
          message: 'Job re-queued',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 400 });
      }
    },
    {
      rateLimitKey: 'queue.jobs.retry',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
