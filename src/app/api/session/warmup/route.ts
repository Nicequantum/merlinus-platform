import { withAuth } from '@/lib/apiRoute';
import { getPrisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * P1-2 — Authenticated keep-alive for any signed-in user (tech, manager, owner).
 * Warms Worker isolate + D1/Prisma so the first bay click is not the cold path.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const started = Date.now();
      try {
        await getPrisma().$queryRaw`SELECT 1`;
      } catch (error) {
        logger.warn('session.warmup_db_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          ok: false,
          warmed: false,
          technicianId: session.technicianId,
          durationMs: Date.now() - started,
        };
      }

      return {
        ok: true,
        warmed: true,
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
        durationMs: Date.now() - started,
      };
    },
    {
      rateLimitKey: 'session.warmup',
      skipRateLimit: true,
      skipPasswordChange: true,
      skipMfa: true,
      skipConsent: true,
      skipLegalDisclaimer: true,
      useRls: false,
      requireDealershipContext: false,
    }
  );
}
