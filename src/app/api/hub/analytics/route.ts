import { withAuth } from '@/lib/apiRoute';
import { buildHubAnalytics } from '@/lib/hub/analytics';
import { listVoiceAgents } from '@/lib/voiceAgent/registry';

/** Voice + appointment analytics for the Unified Hub. */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const days = Math.min(Math.max(Number(url.searchParams.get('days') || '30'), 1), 90);
      const analytics = await buildHubAnalytics(session.dealershipId, days);
      return {
        analytics,
        agents: listVoiceAgents().map((a) => ({
          id: a.id,
          displayName: a.displayName,
          department: a.department,
          description: a.description,
        })),
      };
    },
    {
      rateLimitKey: 'hub.analytics',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
