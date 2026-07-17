import { withAuth } from '@/lib/apiRoute';
import { drainKvCompanionEvents } from '@/lib/companionHub';
import { RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DEFAULT_LOOKBACK_MS = 120_000;

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

      const events = await drainKvCompanionEvents(session.technicianId, sinceIso);
      return { events, since: sinceIso };
    },
    {
      rateLimitKey: 'companion.poll',
      rateLimit: RATE_LIMITS.companion,
      requireDealershipContext: true,
    }
  );
}