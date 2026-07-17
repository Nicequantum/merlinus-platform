import { withAuth } from '@/lib/apiRoute';
import { getAuditDashboardSummary } from '@/lib/auditSummary';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) =>
      getAuditDashboardSummary({ dealershipId: session.dealershipId, dealerId: session.dealerId }),
    { rateLimitKey: 'audit-logs.summary', requireManager: true }
  );
}