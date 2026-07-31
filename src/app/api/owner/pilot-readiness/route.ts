import { NextResponse } from 'next/server';
import {
  evaluatePlatformReadiness,
  evaluateRooftopReadiness,
} from '@/lib/pilotReadiness/evaluatePlatformReadiness';
import { withAuth } from '@/lib/apiRoute';
import { apiError, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isApexPlatformMode } from '@/lib/platformMode';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { rlsContextFromSession } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { getRequestIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/owner/pilot-readiness
 *   Platform gates for national onboard (default)
 * GET /api/owner/pilot-readiness?dealershipId=…
 *   Post-provision rooftop checklist for a single pilot store
 *
 * National owner only — button-driven substitute for shell verify:p0 at provision time.
 */
export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Pilot readiness is only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const dealershipId = url.searchParams.get('dealershipId')?.trim() || '';

      try {
        if (dealershipId) {
          const rooftop = await evaluateRooftopReadiness(dealershipId);
          if (!rooftop) {
            return apiError('Dealership not found.', 404);
          }

          try {
            await writeAuditedAccess(
              {
                action: 'owner.national_access',
                dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
                dealerId: auditDealerIdFromSession(session),
                technicianId: session.technicianId,
                entityType: 'owner_console',
                entityId: dealershipId,
                ipAddress: getRequestIp(request),
                authSource: 'legacy',
                scopeMode: 'national',
                metadata: {
                  surface: 'owner.pilot_readiness.rooftop',
                  dealershipId,
                  overall: rooftop.overall,
                },
              },
              { rls: { ...rlsContextFromSession(session), enforced: true } }
            );
          } catch {
            // audit best-effort
          }

          return NextResponse.json(rooftop, {
            headers: { 'Cache-Control': 'no-store' },
          });
        }

        const platform = await evaluatePlatformReadiness();

        try {
          await writeAuditedAccess(
            {
              action: 'owner.national_access',
              dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
              dealerId: auditDealerIdFromSession(session),
              technicianId: session.technicianId,
              entityType: 'owner_console',
              entityId: session.technicianId,
              ipAddress: getRequestIp(request),
              authSource: 'legacy',
              scopeMode: 'national',
              metadata: {
                surface: 'owner.pilot_readiness.platform',
                overall: platform.overall,
                canProvision: platform.canProvision,
              },
            },
            { rls: { ...rlsContextFromSession(session), enforced: true } }
          );
        } catch {
          // audit best-effort
        }

        return NextResponse.json(platform, {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        logger.error('owner.pilot_readiness_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return handleRouteError(error, 'owner.pilot_readiness');
      }
    },
    {
      requireOwner: true,
      requireOwnerNational: true,
      rateLimitKey: 'owner.pilot-readiness',
      useRls: false,
    }
  );
}
