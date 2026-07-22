/**
 * SSE stream of luxury AI job progress for a single job.
 * Combines in-isolate pub/sub with D1 polling (cross-isolate safe).
 */
import { withAuth } from '@/lib/apiRoute';
import { getAiJobForDealership, getAiJobForTechnician } from '@/lib/aiJobs/service';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import {
  luxuryPhaseFromProgress,
  subscribeJobEvents,
  type AiJobEvent,
} from '@/lib/queue/jobEventsHub';
import { parseRouteParams } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const paramsSchema = z.object({ jobId: z.string().trim().min(1).max(64) });

const HEARTBEAT_MS = 15_000;
const DB_POLL_MS = 1_200;

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const routeParams = await parseRouteParams(paramsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const jobId = routeParams.data.jobId;

  return withAuth(
    request,
    async (session) => {
      // Manager can watch any dealership job; tech only own jobs
      const isManager =
        session.role === 'manager' || session.isAdmin || session.role === 'owner';
      const initial = isManager
        ? await getAiJobForDealership(jobId, session.dealershipId)
        : await getAiJobForTechnician(jobId, session.technicianId);
      if (!initial) return apiError(NOT_FOUND_ERROR, 404);

      const encoder = new TextEncoder();
      let closed = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const push = (event: AiJobEvent | Record<string, unknown>) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(sseData(event)));
            } catch {
              closed = true;
            }
          };

          push({
            type: 'job.connected',
            jobId,
            status: initial.status,
            phase: luxuryPhaseFromProgress(initial.status, initial.progress),
            progress: initial.progress,
            kind: initial.kind,
            errorMessage: initial.errorMessage,
            timestamp: new Date().toISOString(),
          });

          // Terminal already?
          if (
            initial.status === 'succeeded' ||
            initial.status === 'failed' ||
            initial.status === 'cancelled'
          ) {
            push({
              type: 'job.update',
              jobId,
              status: initial.status,
              phase: luxuryPhaseFromProgress(initial.status, initial.progress),
              progress: initial.progress,
              errorMessage: initial.errorMessage,
              kind: initial.kind,
              timestamp: new Date().toISOString(),
              result: initial.result,
            });
          }

          const unsub = subscribeJobEvents(jobId, (event) => {
            push(event);
            if (
              event.phase === 'complete' ||
              event.phase === 'failed' ||
              event.phase === 'cancelled' ||
              event.status === 'succeeded' ||
              event.status === 'failed' ||
              event.status === 'cancelled'
            ) {
              // Keep stream briefly so client receives final event
              setTimeout(() => close(), 400);
            }
          });

          const heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
              push({
                type: 'job.heartbeat',
                jobId,
                timestamp: new Date().toISOString(),
              });
            } catch {
              close();
            }
          }, HEARTBEAT_MS);

          // Cross-isolate: poll D1 for status changes
          let lastStatus = initial.status;
          let lastProgress = initial.progress;
          const dbPoll = setInterval(() => {
            void (async () => {
              if (closed) return;
              try {
                const job = isManager
                  ? await getAiJobForDealership(jobId, session.dealershipId)
                  : await getAiJobForTechnician(jobId, session.technicianId);
                if (!job || closed) return;
                if (job.status !== lastStatus || job.progress !== lastProgress) {
                  lastStatus = job.status;
                  lastProgress = job.progress;
                  push({
                    type: 'job.update',
                    jobId,
                    status: job.status,
                    phase: luxuryPhaseFromProgress(job.status, job.progress),
                    progress: job.progress,
                    errorMessage: job.errorMessage,
                    kind: job.kind,
                    timestamp: new Date().toISOString(),
                    ...(job.status === 'succeeded' ? { result: job.result } : {}),
                  });
                }
                if (
                  job.status === 'succeeded' ||
                  job.status === 'failed' ||
                  job.status === 'cancelled'
                ) {
                  setTimeout(() => close(), 300);
                }
              } catch {
                // ignore poll errors
              }
            })();
          }, DB_POLL_MS);

          const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            clearInterval(dbPoll);
            unsub();
            try {
              controller.close();
            } catch {
              // already closed
            }
          };

          request.signal.addEventListener('abort', close);
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    },
    {
      rateLimitKey: 'queue.job_events',
      requireDealershipContext: true,
      skipRateLimit: false,
    }
  );
}
