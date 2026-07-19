import { withAuth } from '@/lib/apiRoute';
import { getPrisma } from '@/lib/db';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isApexPlatformMode } from '@/lib/platformMode';

export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/warmup
 *
 * Lightweight national-owner keep-alive:
 * - Resolves session (warms auth path)
 * - Runs `SELECT 1` on D1/Prisma (warms isolate + adapter)
 *
 * Called on national dashboard mount and on a soft interval so the first
 * enter-dealership / summary click is not the cold-start path.
 */
export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Owner warmup is only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const started = Date.now();
      try {
        await getPrisma().$queryRaw`SELECT 1`;
      } catch (error) {
        logger.warn('owner.warmup_db_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Still return 200 with warmed:false so clients can fall through to real data fetches
        // (those use their own retries). Avoid 500 stampede on transient D1 blips.
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
        durationMs: Date.now() - started,
      };
    },
    {
      requireOwner: true,
      // Allow while in dealership scope too (keep-alive after enter).
      requireOwnerNational: false,
      rateLimitKey: 'owner.warmup',
      skipRateLimit: true,
      useRls: false,
      skipPasswordChange: true,
    }
  );
}
