import { withAuth } from '@/lib/apiRoute';
import {
  drainKvCompanionEvents,
  listCompanionPresence,
  touchCompanionPresence,
} from '@/lib/companionHub';
import { getCompanionDeviceIdFromRequest } from '@/lib/companionPublish';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LOOKBACK_MS = 180_000;

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const sinceParam = url.searchParams.get('since');
      const sinceIso =
        sinceParam && !Number.isNaN(Date.parse(sinceParam))
          ? sinceParam
          : new Date(Date.now() - DEFAULT_LOOKBACK_MS).toISOString();

      const deviceId = getCompanionDeviceIdFromRequest(request);
      const repairOrderId = url.searchParams.get('repairOrderId');
      const lineId = url.searchParams.get('lineId');

      const [events, presence] = await Promise.all([
        drainKvCompanionEvents(session.technicianId, sinceIso),
        touchCompanionPresence(session.technicianId, {
          deviceId,
          lastSeenAt: new Date().toISOString(),
          repairOrderId: repairOrderId || null,
          lineId: lineId || null,
        }).catch(async () => listCompanionPresence(session.technicianId)),
      ]);

      const peers = presence.filter((d) => d.deviceId !== deviceId);

      return {
        events,
        since: sinceIso,
        presence: {
          devices: presence,
          peerCount: peers.length,
          peers,
        },
      };
    },
    {
      rateLimitKey: 'companion.poll',
      rateLimit: RATE_LIMITS.companion,
      requireDealershipContext: true,
    }
  );
}
