import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { buildHubTimeline } from '@/lib/hub/timeline';

/**
 * Unified appointments + conversations timeline for the rooftop hub.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const q = url.searchParams.get('q')?.trim() || undefined;
      const fromRaw = url.searchParams.get('from');
      const toRaw = url.searchParams.get('to');
      const limit = Number(url.searchParams.get('limit') || '80');
      const from = fromRaw ? new Date(fromRaw) : undefined;
      const to = toRaw ? new Date(toRaw) : undefined;

      const timeline = await buildHubTimeline({
        dealershipId: session.dealershipId,
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
        q,
        limit: Number.isFinite(limit) ? limit : 80,
      });

      // Lightweight stats
      const db = getRlsDb();
      const now = new Date();
      const weekAhead = new Date(now.getTime() + 7 * 24 * 3600_000);
      const [upcomingAppts, openCalls, insights] = await Promise.all([
        db.serviceAppointment.count({
          where: {
            dealershipId: session.dealershipId,
            startsAt: { gte: now, lte: weekAhead },
            status: { in: ['scheduled', 'confirmed'] },
          },
        }),
        db.voiceCall.count({
          where: {
            dealershipId: session.dealershipId,
            status: { in: ['in_progress', 'ringing'] },
          },
        }),
        db.conversationInsight.count({
          where: { dealershipId: session.dealershipId },
        }),
      ]);

      return {
        ...timeline,
        stats: {
          upcomingAppointments7d: upcomingAppts,
          openCalls,
          insightsGenerated: insights,
        },
        dealershipName: session.dealershipName,
      };
    },
    {
      rateLimitKey: 'hub.timeline',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
  );
}
