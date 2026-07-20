import { withAuth } from '@/lib/apiRoute';
import { getDb } from '@/lib/db';
import { withRlsBypass } from '@/lib/apex/rlsContext';

/**
 * High-level national owner overview for the Conversation Hub.
 * Aggregates appointments + call volume across rooftops (owner national scope).
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async () => {
      const since = new Date(Date.now() - 7 * 24 * 3600_000);

      const data = await withRlsBypass(async () => {
        const db = await getDb();
        const dealerships = await db.dealership.findMany({
          where: { id: { not: '__apex_national__' } },
          select: { id: true, name: true },
          take: 100,
        });

        const rows = await Promise.all(
          dealerships.map(async (d) => {
            const [apptCount, callCount, insightCount] = await Promise.all([
              db.serviceAppointment.count({
                where: { dealershipId: d.id, startsAt: { gte: since } },
              }),
              db.voiceCall.count({
                where: { dealershipId: d.id, createdAt: { gte: since } },
              }),
              db.conversationInsight.count({
                where: { dealershipId: d.id, createdAt: { gte: since } },
              }),
            ]);
            return {
              dealershipId: d.id,
              dealershipName: d.name,
              appointments7d: apptCount,
              calls7d: callCount,
              insights7d: insightCount,
            };
          })
        );

        const totals = rows.reduce(
          (acc, r) => {
            acc.appointments7d += r.appointments7d;
            acc.calls7d += r.calls7d;
            acc.insights7d += r.insights7d;
            return acc;
          },
          { appointments7d: 0, calls7d: 0, insights7d: 0 }
        );

        return { rooftops: rows, totals, windowDays: 7 };
      });

      return data;
    },
    {
      rateLimitKey: 'hub.national',
      requireOwner: true,
      requireOwnerNational: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
