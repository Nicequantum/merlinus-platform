import { withAuth } from '@/lib/apiRoute';
import { getActiveRlsContext, getRlsDb, hasActiveRlsClient, rlsTransaction } from '@/lib/apex/rlsContext';
import { getPrisma } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * Authenticated keep-alive for any signed-in user (tech, manager, owner).
 * Warms Worker isolate + D1/Prisma + the same RLS path RO create will use
 * so the first Process RO after idle is less likely to hit a cold D1 miss.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const started = Date.now();
      let dbOk = false;
      let roPathWarmed = false;
      let rlsPathWarmed = false;

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
          paths: { db: false, roList: false, rls: false },
        };
      }

      // Light tenant path warm — select id only (no PII decrypt).
      if (session.dealershipId?.trim()) {
        try {
          const managerLike =
            session.role === 'manager' || session.role === 'owner' || session.isAdmin;
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

        // Same RLS client + rlsTransaction shape as POST /api/repair-orders create.
        // withAuth useRls=true below so getRlsDb() is tenant-bound.
        try {
          if (!hasActiveRlsClient()) {
            throw new Error('warmup missing RLS client (useRls must be true)');
          }
          await rlsTransaction(async (tx) => {
            await tx.repairOrder.findFirst({
              where: { dealershipId: session.dealershipId },
              select: { id: true },
              orderBy: { updatedAt: 'desc' },
            });
          });
          // Touch getRlsDb once more (create path uses both)
          void getRlsDb();
          rlsPathWarmed = Boolean(getActiveRlsContext());
        } catch (error) {
          logger.warn('session.warmup_rls_path_failed', {
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
        paths: { db: dbOk, roList: roPathWarmed, rls: rlsPathWarmed },
        metrics: {
          bayColdStartProbe: true,
          roPathWarmed,
          rlsPathWarmed,
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
      // Match create path: bind tenant RLS client so warm hits the same D1 binding path.
      useRls: true,
      requireDealershipContext: false,
    }
  );
}
