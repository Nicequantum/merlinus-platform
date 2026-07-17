import { getRlsDb } from '@/lib/apex/rlsContext';
import { scopedPiiWhere } from '@/lib/apex/tenantScope';
import { withAuth } from '@/lib/apiRoute';
import { canAccessRepairOrder } from '@/lib/repairOrderAccess';
import { auditLatestQuerySchema, parseQueryParams } from '@/lib/validation';

const WARRANTY_STORY_ACTIONS = [
  'story.generate',
  'story.score',
  'story.review',
  'story.edit',
  'story.certify',
] as const;
const CUSTOMER_PAY_STORY_ACTIONS = [
  'customerPayTemplateApplied',
  'customerPayStory.edit',
  'customerPayStory.pdf_export',
] as const;

export async function GET(request: Request) {
  const query = parseQueryParams(request, auditLatestQuerySchema);
  if ('error' in query) return query.error;

  return withAuth(
    request,
    async (session) => {
      const { repairLineId } = query.data;
      const db = getRlsDb();

      const line = await db.repairLine.findFirst({
        where: {
          id: repairLineId,
          repairOrder: scopedPiiWhere(session),
        },
        select: { id: true, isCustomerPay: true, repairOrderId: true },
      });

      if (!line) {
        return { hash: null, promptVersion: null };
      }

      const ro = await canAccessRepairOrder(session, line.repairOrderId, {});
      if (!ro) {
        return { hash: null, promptVersion: null };
      }

      const actions = line.isCustomerPay
        ? [...CUSTOMER_PAY_STORY_ACTIONS]
        : [...WARRANTY_STORY_ACTIONS];

      const latestLog = await db.auditLog.findFirst({
        where: {
          ...scopedPiiWhere(session),
          entityType: 'repairLine',
          entityId: repairLineId,
          action: { in: actions },
          entryHash: { not: '' },
        },
        orderBy: { createdAt: 'desc' },
        select: { entryHash: true, promptVersion: true },
      });

      return {
        hash: latestLog?.entryHash ?? null,
        promptVersion: latestLog?.promptVersion ?? null,
      };
    },
    { rateLimitKey: 'audit-logs.latest', requireDealershipContext: true }
  );
}
