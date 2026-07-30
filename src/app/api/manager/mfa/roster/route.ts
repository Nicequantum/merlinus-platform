/**
 * Dealership MFA enrollment roster — manager/owner compliance view.
 */
import { withAuth } from '@/lib/apiRoute';
import { listDealershipMfaRoster } from '@/lib/mfa/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const roster = await listDealershipMfaRoster(session.dealershipId);
      return { ok: true, ...roster };
    },
    {
      rateLimitKey: 'manager.mfa.roster',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
