import { withAuth } from '@/lib/apiRoute';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  logUnhealthyServices,
  resolveAuthenticatedHealthHttpStatus,
  resolveModuleHealthSummary,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import { getRuntimeConfig } from '@/lib/env';
import { logger } from '@/lib/logger';
import { PROMPT_VERSION } from '@/prompts/version';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

/**
 * Manager-authenticated enterprise health.
 * P0-3: module-aware Twilio/SMS checks when dealership context is present;
 * returns enabled SKU summary for the active rooftop.
 * Error details logged server-side only (not in services payload).
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const dealershipId = session.dealershipId?.trim() || null;
      const checks = await runAuthenticatedHealthChecks({ dealershipId });
      const status = aggregateAuthenticatedHealthStatus(checks);
      logUnhealthyServices(checks);

      if (status !== 'ok') {
        logger.warn('health.summary', {
          status,
          dealershipId,
          failed: Object.entries(checks)
            .filter(([, c]) => c.status === 'error')
            .map(([name]) => name),
          warned: Object.entries(checks)
            .filter(([, c]) => c.status === 'warn')
            .map(([name]) => name),
        });
      }

      const modules = await resolveModuleHealthSummary(dealershipId);
      const config = getRuntimeConfig(PROMPT_VERSION);
      const aiJobs = checks.aiJobsQueue;
      const aiOps =
        typeof aiJobs?.detail === 'string' && aiJobs.detail.includes('| ops: ')
          ? aiJobs.detail.split('| ops: ').slice(1).join('| ops: ').trim()
          : undefined;
      const payload = {
        status,
        version: config.appVersion,
        promptVersion: PROMPT_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
        dealershipId,
        modules,
        modulesEnabled: modules.filter((m) => m.enabled).map((m) => m.moduleId),
        services: buildHealthServicesPayload(checks),
        /** P0-4 — first-class AI queue signal (status also in services.aiJobsQueue) */
        aiJobsQueue: {
          status: aiJobs?.status ?? 'ok',
          latencyMs: aiJobs?.latencyMs,
          operatorGuidance: aiOps,
        },
      };

      const statusCode = resolveAuthenticatedHealthHttpStatus(checks);
      return Response.json(payload, {
        status: statusCode,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    {
      rateLimitKey: 'health',
      requireManager: true,
      skipRateLimit: true,
      // National owner without enter-dealership can still probe platform deps
      requireDealershipContext: false,
    }
  );
}
