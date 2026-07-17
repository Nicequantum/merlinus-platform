import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { withAuth } from '@/lib/apiRoute';
import { clearCustomerPayMode } from '@/lib/customerPayTemplate';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';

import { loadStoryRouteRepairOrder } from '@/lib/repairOrderAccess';
import { getRequestIp } from '@/lib/rate-limit';
import { parseRouteParams, repairOrderLineParamsSchema } from '@/lib/validation';

/** M1: Dedicated endpoint to clear Customer Pay mode and re-enable warranty AI flows. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const routeParams = await parseRouteParams(repairOrderLineParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id, lineId } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const ro = await loadStoryRouteRepairOrder(session, id);
      if (!ro) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const line = ro.repairLines.find((l) => l.id === lineId);
      if (!line) return apiError(NOT_FOUND_ERROR, 404);

      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));

      await clearCustomerPayMode({
        repairOrderId: id,
        repairLineId: lineId,
        dealershipId: session.dealershipId,
        technicianId: session.technicianId,
        // APEX NATIONAL PLATFORM — stamp dealerId from authenticated session when present.
        dealerId: dealerFields.dealerId,
        ipAddress: getRequestIp(request),
      });

      return { ok: true, isCustomerPay: false };
    },
    {
      rateLimitKey: 'ros.update',
      blockServiceAdvisorAi: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}