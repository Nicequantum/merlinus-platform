import { withAuth } from '@/lib/apiRoute';
import { getActiveRlsContext, getRlsDb, hasActiveRlsClient, rlsTransaction } from '@/lib/apex/rlsContext';
import { getDb, getPrisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { probeObjectStorage } from '@/lib/storage/objectStorage';

export const dynamic = 'force-dynamic';

/**
 * Authenticated keep-alive for any signed-in user (tech, manager, owner).
 * Warms Worker isolate + D1/Prisma + RLS create path + R2 binding + AuditLog
 * base-client read so first RO photo upload (R2 put + image.upload audit)
 * succeeds after cold open/idle.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const started = Date.now();
      let dbOk = false;
      let roPathWarmed = false;
      let rlsPathWarmed = false;
      let r2Warmed = false;
      let auditPathWarmed = false;

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
          paths: { db: false, roList: false, rls: false, r2: false, audit: false },
        };
      }

      // Cheap R2 list — resolves OpenNext ALS binding so first put is less cold.
      try {
        await probeObjectStorage();
        r2Warmed = true;
      } catch (error) {
        logger.warn('session.warmup_r2_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
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

        // Base-client AuditLog touch — same path as image.upload / ro.create chain read.
        try {
          const base = await getDb();
          await base.$queryRawUnsafe(
            `SELECT "entryHash" AS entryHash FROM "AuditLog" WHERE "dealershipId" = ? ORDER BY "createdAt" DESC LIMIT 1`,
            session.dealershipId
          );
          auditPathWarmed = true;
        } catch (error) {
          logger.warn('session.warmup_audit_path_failed', {
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
        paths: {
          db: dbOk,
          roList: roPathWarmed,
          rls: rlsPathWarmed,
          r2: r2Warmed,
          audit: auditPathWarmed,
        },
        metrics: {
          bayColdStartProbe: true,
          roPathWarmed,
          rlsPathWarmed,
          r2Warmed,
          auditPathWarmed,
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
