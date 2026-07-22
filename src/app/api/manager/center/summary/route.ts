/**
 * Manager Control Center — single aggregate snapshot for the control plane UI.
 */
import { withAuth } from '@/lib/apiRoute';
import { buildManagerCenterSummary } from '@/lib/manager/centerSummary';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const summary = await buildManagerCenterSummary({
        dealershipId: session.dealershipId,
      });
      return summary;
    },
    {
      rateLimitKey: 'manager.center.summary',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
