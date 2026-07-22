/**
 * Manager Control Center live SSE stream.
 * Same-isolate hub fan-out + D1/health polling for multi-isolate Workers.
 */
import { withAuth } from '@/lib/apiRoute';
import { listDealershipAiJobs } from '@/lib/aiJobs/service';
import {
  aggregateAuthenticatedHealthStatus,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import {
  canAcceptControlCenterConnection,
  getControlCenterMaxConnections,
  publishHealthChangedToCenter,
  subscribeControlCenterEvents,
  trackControlCenterConnection,
  type ControlCenterEvent,
} from '@/lib/manager/controlCenterHub';
import { isMaintenanceModeEnabled } from '@/lib/env';
import { apiError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const HEARTBEAT_MS = 30_000;
const JOB_POLL_MS = 2_500;
const HEALTH_POLL_MS = 20_000;

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function healthFingerprint(checks: Record<string, { status: string }>, overall: string): string {
  const parts = Object.entries(checks)
    .map(([k, v]) => `${k}:${v.status}`)
    .sort();
  return `${overall}|${isMaintenanceModeEnabled() ? 'm1' : 'm0'}|${parts.join(',')}`;
}

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const dealershipId = session.dealershipId?.trim() || '';
      if (!dealershipId) {
        return apiError('Dealership context required', 403);
      }

      if (!canAcceptControlCenterConnection(dealershipId)) {
        return apiError(
          `Too many live connections for this rooftop (max ${getControlCenterMaxConnections()}). Close other tabs.`,
          429
        );
      }

      const releaseConnection = trackControlCenterConnection(dealershipId);
      const encoder = new TextEncoder();
      let closed = false;

      // Seed job fingerprint from D1
      let lastJobSig = '';
      try {
        const jobs = await listDealershipAiJobs({ dealershipId, take: 20 });
        lastJobSig = jobs
          .map((j) => `${j.id}:${j.status}:${j.progress}`)
          .join('|');
      } catch {
        lastJobSig = '';
      }

      let lastHealthFp = '';
      try {
        const checks = await runAuthenticatedHealthChecks({ dealershipId });
        const overall = aggregateAuthenticatedHealthStatus(checks);
        lastHealthFp = healthFingerprint(checks, overall);
      } catch {
        lastHealthFp = '';
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const push = (event: ControlCenterEvent | Record<string, unknown>) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(sseData(event)));
            } catch {
              closed = true;
            }
          };

          push({
            type: 'center.connected',
            dealershipId,
            timestamp: new Date().toISOString(),
            message: 'Control Center live connected',
            maxConnections: getControlCenterMaxConnections(),
          });

          const unsub = subscribeControlCenterEvents(dealershipId, (event) => {
            push(event);
          });

          const heartbeat = setInterval(() => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
              push({
                type: 'center.heartbeat',
                dealershipId,
                timestamp: new Date().toISOString(),
              });
            } catch {
              close();
            }
          }, HEARTBEAT_MS);

          // Cross-isolate job convergence
          const jobPoll = setInterval(() => {
            void (async () => {
              if (closed) return;
              try {
                const jobs = await listDealershipAiJobs({ dealershipId, take: 20 });
                const sig = jobs.map((j) => `${j.id}:${j.status}:${j.progress}`).join('|');
                if (sig !== lastJobSig) {
                  lastJobSig = sig;
                  // Emit latest changed jobs (cap fan-out)
                  for (const j of jobs.slice(0, 12)) {
                    push({
                      type: 'job:updated',
                      dealershipId,
                      timestamp: new Date().toISOString(),
                      job: {
                        id: j.id,
                        kind: j.kind,
                        status: j.status,
                        progress: j.progress,
                        phase: j.phase,
                        technicianId: j.technicianId,
                        errorMessage: j.errorMessage,
                        entityId: j.entityId,
                      },
                    });
                  }
                }
              } catch {
                // ignore poll errors
              }
            })();
          }, JOB_POLL_MS);

          // Health poll (less frequent)
          const healthPoll = setInterval(() => {
            void (async () => {
              if (closed) return;
              try {
                const checks = await runAuthenticatedHealthChecks({ dealershipId });
                const overall = aggregateAuthenticatedHealthStatus(checks);
                const fp = healthFingerprint(checks, overall);
                if (fp !== lastHealthFp) {
                  lastHealthFp = fp;
                  const critical = [
                    { id: 'database', label: 'Database', status: checks.database?.status || 'ok' },
                    {
                      id: 'ai',
                      label: 'AI (Grok)',
                      status:
                        checks.grok?.status === 'error' || checks.grokConfig?.status === 'error'
                          ? 'error'
                          : checks.grok?.status === 'warn' || checks.grokConfig?.status === 'warn'
                            ? 'warn'
                            : 'ok',
                    },
                    {
                      id: 'queue',
                      label: 'AI Jobs Queue',
                      status: checks.aiJobsQueue?.status || 'ok',
                    },
                    {
                      id: 'voice',
                      label: 'Voice',
                      status: checks.voiceDepartments?.status || checks.voice?.status || 'ok',
                    },
                    {
                      id: 'storage',
                      label: 'Object storage (R2)',
                      status: checks.objectStorage?.status || 'ok',
                    },
                  ];
                  publishHealthChangedToCenter({
                    dealershipId,
                    overall,
                    maintenanceMode: isMaintenanceModeEnabled(),
                    critical,
                  });
                  push({
                    type: 'health:changed',
                    dealershipId,
                    timestamp: new Date().toISOString(),
                    health: {
                      overall,
                      maintenanceMode: isMaintenanceModeEnabled(),
                      critical,
                    },
                  });
                }
              } catch {
                // ignore
              }
            })();
          }, HEALTH_POLL_MS);

          const close = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            clearInterval(jobPoll);
            clearInterval(healthPoll);
            unsub();
            releaseConnection();
            try {
              controller.close();
            } catch {
              // already closed
            }
          };

          request.signal.addEventListener('abort', close);
        },
        cancel() {
          closed = true;
          releaseConnection();
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
      rateLimitKey: 'manager.center.live',
      requireManager: true,
      requireDealershipContext: true,
      skipRateLimit: false,
    }
  );
}
