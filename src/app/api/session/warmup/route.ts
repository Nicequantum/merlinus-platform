import { withAuth } from '@/lib/apiRoute';
import { getPrisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Authenticated keep-alive for any signed-in user (tech, manager, owner).
 * Warms Worker isolate + D1/Prisma + a light tenant-scoped RO probe so the
 * first bay list/open click is not the cold path.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const started = Date.now();
      let dbOk = false;
      let roPathWarmed = false;
      try {
        await getPrisma().$queryRaw`SELECT 1`;
        dbOk = true;
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
          paths: { db: false, roList: false },
        };
      }

      // Light tenant path warm — select id only (no PII decrypt).
      if (session.dealershipId?.trim()) {
        try {
          const managerLike =
            session.role === 'manager' ||
            session.role === 'owner' ||
            session.isAdmin;
          await getPrisma().repairOrder.findFirst({
            where: {
              dealershipId: session.dealershipId,
              ...(managerLike ? {} : { technicianId: session.technicianId }),
            },
            select: { id: true },
            orderBy: { updatedAt: 'desc' },
          });
          roPathWarmed = true;
        } catch (error) {
          logger.warn('session.warmup_ro_path_failed', {
            technicianId: session.technicianId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return {
        ok: true,
        warmed: dbOk,
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
        durationMs: Date.now() - started,
        paths: { db: dbOk, roList: roPathWarmed },
        metrics: {
          bayColdStartProbe: true,
          roPathWarmed,
        },
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
