import {
  getOwnerBillingSummary,
  parseBillingPeriod,
} from '@/lib/apex/ownerBillingSummary';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { rlsContextFromSession } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { isApexPlatformMode } from '@/lib/platformMode';
import { apiError, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * National / group owner billing meters — owner national console only.
 */
export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Owner billing is only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const period = parseBillingPeriod(url.searchParams.get('period'));

      let summary;
      try {
        summary = await getOwnerBillingSummary(
          {
            technicianId: session.technicianId,
            scopeMode: session.scopeMode,
            activeDealerGroupId: session.activeDealerGroupId,
            dealerGroupName: session.dealerGroupName,
          },
          period
        );
      } catch (error) {
        logger.error('owner.billing_compute_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return handleRouteError(error, 'owner.billing');
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
              surface: 'owner.billing',
              period,
              rooftops: summary.totals.rooftops,
              storiesFirst: summary.totals.storiesFirst,
              estimatedTotalCents: summary.totals.estimatedTotalCents,
            },
          },
          { rls: { ...rlsContextFromSession(session), enforced: true } }
        );
      } catch (error) {
        logger.error('owner.billing_audit_failed', {
          technicianId: session.technicianId,
          error: error instanceof Error ? error.message : String(error),
        });
        return handleRouteError(error, 'owner.billing');
      }

      return summary;
    },
    { requireOwner: true, requireOwnerNational: true, rateLimitKey: 'owner.billing' }
  );
}
