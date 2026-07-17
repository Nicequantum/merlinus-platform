import { NextResponse } from 'next/server';
import { scopedPiiWhere } from '@/lib/apex/tenantScope';
import { withAuth } from '@/lib/apiRoute';
import { listModuleStatuses } from '@/lib/modules/entitlements';

/**
 * PR-M0 — Manager read-only module entitlement status for the active rooftop.
 * Does not enable/disable modules (write path deferred).
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const { dealershipId } = scopedPiiWhere(session);
      const modules = await listModuleStatuses(dealershipId);
      return NextResponse.json({
        dealershipId,
        modules,
        /** Explicit reminder: core story is never a product module flag. */
        coreStoryAlwaysOn: true,
      });
    },
    {
      rateLimitKey: 'modules.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
