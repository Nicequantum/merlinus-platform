import { listOwnerDealerGroupMemberships } from '@/lib/apex/dealerGroupAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { isApexPlatformMode } from '@/lib/platformMode';

/**
 * Phase 7.3 — list DealerGroups the owner may switch into (multi-group switcher).
 */
export async function GET(request: Request) {
  if (!isApexPlatformMode()) {
    return apiError('Dealer groups are only available in apex platform mode.', 404);
  }

  return withAuth(
    request,
    async (session) => {
      const memberships = await listOwnerDealerGroupMemberships(session.technicianId);
      return {
        groups: memberships.map((m) => ({
          id: m.dealerGroupId,
          code: m.dealerGroupCode,
          name: m.dealerGroupName,
          legalName: m.legalName,
          role: m.role,
          isPrimary: m.isPrimary,
          isActive: true,
        })),
        activeDealerGroupId: session.activeDealerGroupId ?? null,
        scopeMode: session.scopeMode ?? null,
      };
    },
    {
      requireOwner: true,
      requireOwnerNational: true,
      rateLimitKey: 'owner.dealer_groups',
    }
  );
}
