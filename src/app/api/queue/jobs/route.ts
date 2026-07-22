/**
 * Manager Job Monitor — list active + recent durable AI jobs for the rooftop.
 */
import { withAuth } from '@/lib/apiRoute';
import {
  getDealershipJobHealthStats,
  listDealershipAiJobs,
} from '@/lib/aiJobs/service';
import { getQueueMetricsSnapshot } from '@/lib/queue/metrics';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  status: z
    .enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'active', 'all'])
    .optional()
    .default('all'),
  technicianId: z.string().trim().min(1).max(64).optional(),
  /** Filter by repair line id or entity id (RO line / inspection). */
  entityId: z.string().trim().min(1).max(64).optional(),
  kind: z.string().trim().min(1).max(64).optional(),
  take: z.coerce.number().int().min(1).max(100).optional().default(40),
});

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const parsed = querySchema.safeParse({
        status: url.searchParams.get('status') || undefined,
        technicianId: url.searchParams.get('technicianId') || undefined,
        entityId: url.searchParams.get('entityId') || url.searchParams.get('ro') || undefined,
        kind: url.searchParams.get('kind') || undefined,
        take: url.searchParams.get('take') || undefined,
      });
      if (!parsed.success) {
        return Response.json(
          { error: 'Invalid query', issues: parsed.error.flatten() },
          { status: 400 }
        );
      }

      const { status, technicianId, entityId, kind, take } = parsed.data;
      const dealershipId = session.dealershipId;

      let jobs;
      if (status === 'active') {
        const [queued, running] = await Promise.all([
          listDealershipAiJobs({
            dealershipId,
            status: 'queued',
            technicianId,
            entityId,
            kind,
            take,
          }),
          listDealershipAiJobs({
            dealershipId,
            status: 'running',
            technicianId,
            entityId,
            kind,
            take,
          }),
        ]);
        jobs = [...running, ...queued]
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, take);
      } else if (status === 'all') {
        jobs = await listDealershipAiJobs({
          dealershipId,
          technicianId,
          entityId,
          kind,
          take,
        });
      } else {
        jobs = await listDealershipAiJobs({
          dealershipId,
          status,
          technicianId,
          entityId,
          kind,
          take,
        });
      }

      const health = await getDealershipJobHealthStats(dealershipId);
      const metrics = getQueueMetricsSnapshot();

      return {
        jobs,
        health,
        metrics: {
          enqueued: metrics.enqueued,
          completed: metrics.completed,
          failed: metrics.failed,
          retried: metrics.retried,
          inlineFallback: metrics.inlineFallback,
          byPriority: metrics.byPriority,
          byJobType: metrics.byJobType,
        },
      };
    },
    {
      rateLimitKey: 'queue.jobs.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
