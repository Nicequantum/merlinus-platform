import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';

/** Hub audit trail for the active rooftop. */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const url = new URL(request.url);
      const limit = Math.min(Number(url.searchParams.get('limit') || '50'), 100);
      const rows = await getRlsDb().hubAuditEvent.findMany({
        where: { dealershipId: session.dealershipId },
        orderBy: { createdAt: 'desc' },
        take: Number.isFinite(limit) ? limit : 50,
      });
      return {
        events: rows.map((e) => ({
          id: e.id,
          entityType: e.entityType,
          entityId: e.entityId,
          action: e.action,
          technicianId: e.technicianId,
          metadata: safeJson(e.metadataJson),
          createdAt: e.createdAt.toISOString(),
        })),
      };
    },
    {
      rateLimitKey: 'hub.audit',
      requireManager: true,
      requireDealershipContext: true,
      requireModule: 'calendar_hub',
    }
  );
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const p = JSON.parse(raw || '{}') as unknown;
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
