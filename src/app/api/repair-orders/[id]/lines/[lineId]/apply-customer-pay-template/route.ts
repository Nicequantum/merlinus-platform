import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { withAuth } from '@/lib/apiRoute';
import { applyCustomerPayTemplate } from '@/lib/customerPayTemplate';
import { apiError, NOT_FOUND_ERROR, VALIDATION_ERROR } from '@/lib/errors';

import { getRequestIp } from '@/lib/rate-limit';
import { loadStoryRouteRepairOrder } from '@/lib/repairOrderAccess';
import {
  applyCustomerPayTemplateSchema,
  parseRequestBody,
  parseRouteParams,
  repairOrderLineParamsSchema,
} from '@/lib/validation';

/**
 * Instantly applies a Customer Pay pre-written story — no Grok, no quality audit.
 * Warranty generate/review routes remain separate and unchanged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const routeParams = await parseRouteParams(repairOrderLineParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id: repairOrderId, lineId: repairLineId } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, applyCustomerPayTemplateSchema);
      if ('error' in parsed) return parsed.error;

      if (!(await loadStoryRouteRepairOrder(session, repairOrderId))) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      try {
        const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));

        const result = await applyCustomerPayTemplate({
          repairOrderId,
          repairLineId,
          templateId: parsed.data.templateId,
          dealershipId: session.dealershipId,
          technicianId: session.technicianId,
          // APEX NATIONAL PLATFORM — stamp dealerId from authenticated session when present.
          dealerId: dealerFields.dealerId,
          ipAddress: getRequestIp(request),
        });

        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to apply template';
        if (message.includes('not found')) {
          return apiError(NOT_FOUND_ERROR, 404);
        }
        if (message.includes('not a Customer Pay')) {
          return apiError(VALIDATION_ERROR, 400);
        }
        throw error;
      }
    },
    {
      rateLimitKey: 'repair-orders.apply-customer-pay-template',
      blockServiceAdvisorAi: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}