import { withAuth } from '@/lib/apiRoute';
import { getUsageAnalytics } from '@/lib/usageMonitoring';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => getUsageAnalytics(session.dealershipId, session.dealerId),
    { rateLimitKey: 'admin.usage', requireAdmin: true }
  );
}