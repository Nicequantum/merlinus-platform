import { withAuth } from '@/lib/apiRoute';
import {
  aggregateAuthenticatedHealthStatus,
  buildHealthServicesPayload,
  logUnhealthyServices,
  resolveAuthenticatedHealthHttpStatus,
  runAuthenticatedHealthChecks,
} from '@/lib/healthChecks';
import { getRuntimeConfig } from '@/lib/env';
import { logger } from '@/lib/logger';
import { PROMPT_VERSION } from '@/prompts/version';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

/**
 * Manager-authenticated enterprise health — probes Database, KV, Encryption, and Grok API.
 * Returns per-service status + latency; error details are logged server-side only.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async () => {
      const checks = await runAuthenticatedHealthChecks();
      const status = aggregateAuthenticatedHealthStatus(checks);
      logUnhealthyServices(checks);

      if (status !== 'ok') {
        logger.warn('health.summary', {
          status,
          failed: Object.entries(checks)
            .filter(([, c]) => c.status === 'error')
            .map(([name]) => name),
          warned: Object.entries(checks)
            .filter(([, c]) => c.status === 'warn')
            .map(([name]) => name),
        });
      }

      const config = getRuntimeConfig(PROMPT_VERSION);
      const payload = {
        status,
        version: config.appVersion,
        promptVersion: PROMPT_VERSION,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
        services: buildHealthServicesPayload(checks),
      };

      const statusCode = resolveAuthenticatedHealthHttpStatus(checks);
      return Response.json(payload, {
        status: statusCode,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    { rateLimitKey: 'health', requireManager: true, skipRateLimit: true }
  );
}