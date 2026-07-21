import { withAuth } from '@/lib/apiRoute';
import { getCdkLiveSyncStatus } from '@/lib/cdk/status';

export const dynamic = 'force-dynamic';

/** P3-3 — CDK live sync deferred status for manager UI / ops. */
export async function GET(request: Request) {
  return withAuth(
    request,
    async () => getCdkLiveSyncStatus(),
    {
      rateLimitKey: 'modules.cdk_status',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
