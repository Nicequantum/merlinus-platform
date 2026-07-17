import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';

/**
 * PR-M5a — manager: recent voice calls for the rooftop.
 */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const rows = await getRlsDb().voiceCall.findMany({
        where: { dealershipId: session.dealershipId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          conversation: { select: { activeAgent: true, stateJson: true } },
          line: { select: { label: true, e164Number: true } },
          _count: { select: { segments: true } },
        },
      });

      return {
        calls: rows.map((c) => ({
          id: c.id,
          externalCallId: c.externalCallId,
          status: c.status,
          fromLast4: c.fromLast4,
          toE164: c.toE164,
          direction: c.direction,
          durationSec: c.durationSec,
          startedAt: c.startedAt?.toISOString() ?? null,
          endedAt: c.endedAt?.toISOString() ?? null,
          activeAgent: c.conversation?.activeAgent ?? null,
          routingPath: safeJsonArray(c.routingPathJson),
          lineLabel: c.line?.label ?? null,
          segmentCount: c._count.segments,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },
    {
      rateLimitKey: 'voice.calls.list',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'voice_agent',
    }
  );
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
