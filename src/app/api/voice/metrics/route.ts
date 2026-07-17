import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { aggregateFromCallRows } from '@/lib/voiceAgent/metrics';

/**
 * PR-M5b — manager containment / quality aggregate for the rooftop.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await getRlsDb().voiceCall.findMany({
        where: {
          dealershipId: session.dealershipId,
          createdAt: { gte: since },
        },
        select: {
          status: true,
          contained: true,
          outcome: true,
          metricsJson: true,
          routingPathJson: true,
        },
        take: 2000,
      });

      const aggregate = aggregateFromCallRows(rows);
      return {
        days,
        since: since.toISOString(),
        ...aggregate,
      };
    },
    {
      rateLimitKey: 'voice.metrics',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}
