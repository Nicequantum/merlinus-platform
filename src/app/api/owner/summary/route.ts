import { getOwnerNationalSummary } from '@/lib/apex/ownerNationalSummary';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { rlsContextFromSession } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { isApexPlatformMode } from '@/lib/platformMode';
import { apiError, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/rate-limit';

export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Owner summary is only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      let summary;
      try {
        summary = await getOwnerNationalSummary({
          technicianId: session.technicianId,
          scopeMode: session.scopeMode,
          activeDealerGroupId: session.activeDealerGroupId,
          dealerGroupName: session.dealerGroupName,
        });
      } catch (error) {
        logger.error('owner.summary_compute_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return handleRouteError(error, 'owner.summary');
      }

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
              consoleScope: summary.scopeMode ?? 'national',
              dealerGroupId: summary.dealerGroupId ?? null,
              dealerCount: summary.dealerCount,
              dealershipCount: summary.dealershipCount,
              activeUsers: summary.activeUsers,
              repairOrders7d: summary.repairOrders7d,
              certifiedStories7d: summary.certifiedStories7d,
              adoptionRatePct: summary.adoptionRatePct,
              attentionFlagCount: summary.attentionFlagCount,
              rooftopCount: summary.rooftops?.length ?? 0,
              volumeTrendPct: summary.volumeTrend?.changePct ?? null,
              certificationRatePct: summary.certificationRatePct ?? null,
              aiUsage7d: summary.aiUsage7d ?? 0,
              logins7d: summary.logins7d ?? 0,
            },
          },
          { rls: { ...rlsContextFromSession(session), enforced: true } }
        );
      } catch (error) {
        // Fail-closed audit: do not return metrics without durable access log
        logger.error('owner.summary_audit_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return handleRouteError(error, 'owner.summary');
      }

      return summary;
    },
    { requireOwner: true, requireOwnerNational: true, rateLimitKey: 'owner.summary' }
  );
}
