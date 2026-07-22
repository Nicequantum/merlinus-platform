/**
 * Manager — cancel a queued/running durable AI job.
 */
import { withAuth } from '@/lib/apiRoute';
import {
  getAiJobForDealership,
  markAiJobCancelled,
} from '@/lib/aiJobs/service';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
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
      const job = await getAiJobForDealership(jobId, session.dealershipId);
      if (!job) return apiError(NOT_FOUND_ERROR, 404);

      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        return {
          ok: false,
          jobId,
          status: job.status,
          message: `Job is already ${job.status}`,
        };
      }

      const cancelled = await markAiJobCancelled(jobId);
      try {
        await writeAuditedAccess({
          action: 'story.generate',
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          entityType: 'aiJob',
          entityId: jobId,
          metadata: {
            aiQueue: true,
            outcome: cancelled ? 'cancelled_by_manager' : 'cancel_noop',
            originalKind: job.kind,
          },
        });
      } catch {
        // audit best-effort
      }

      return {
        ok: cancelled,
        jobId,
        status: cancelled ? 'cancelled' : job.status,
        message: cancelled ? 'Job cancelled' : 'Job could not be cancelled',
      };
    },
    {
      rateLimitKey: 'queue.jobs.cancel',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
