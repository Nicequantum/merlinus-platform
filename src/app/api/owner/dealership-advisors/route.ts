import { ownerMayEnterDealership } from '@/lib/apex/dealerGroupAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { isApexPlatformMode } from '@/lib/platformMode';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';
import { isServiceAdvisorActive } from '@/lib/serviceAdvisorAccounts';

/**
 * National Owner View As — list active service advisors for a rooftop
 * before enter-dealership (owner is still in national/group home).
 */
export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Owner dealership advisors are only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const dealershipId = url.searchParams.get('dealershipId')?.trim() || '';
      if (!dealershipId) {
        return apiError('dealershipId is required.', 400);
      }
      if (dealershipId === APEX_NATIONAL_DEALERSHIP_ID) {
        return apiError('Cannot list advisors for the national sentinel.', 403);
      }

      const allowed = await ownerMayEnterDealership(session.technicianId, dealershipId);
      if (!allowed) {
        return apiError('You do not have access to this dealership.', 403);
      }

      const advisors = await withRlsBypass(async () =>
        getRlsDb().serviceAdvisor.findMany({
          where: {
            dealershipId,
            deletedAt: null,
            status: 'active',
          },
          orderBy: { lastSeenAt: 'desc' },
          select: {
            id: true,
            displayNameEncrypted: true,
            advisorCode: true,
            status: true,
            deletedAt: true,
          },
        })
      );

      return {
        dealershipId,
        advisors: advisors
          .filter((a) => isServiceAdvisorActive(a))
          .map((a) => ({
            id: a.id,
            displayName: readAdvisorDisplayNameFromDb(a) || a.advisorCode || a.id,
            advisorCode: a.advisorCode,
          })),
      };
    },
    {
      requireOwner: true,
      requireOwnerNational: true,
      rateLimitKey: 'owner.dealership_advisors',
    }
  );
}
