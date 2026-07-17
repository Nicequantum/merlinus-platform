import { getRlsDb } from '@/lib/apex/rlsContext';
import { scopedPiiWhere } from '@/lib/apex/tenantScope';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { getRequestIp } from '@/lib/rate-limit';
import { auditLogQuerySchema, parseQueryParams } from '@/lib/validation';

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toCsvValue(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const query = parseQueryParams(request, auditLogQuerySchema);
  if ('error' in query) return query.error;

  return withAuth(
    request,
    async (session) => {
      const { technicianId, action, from, to, format } = query.data;
      const where: {
        dealershipId: string;
        dealerId?: string;
        technicianId?: string;
        action?: string;
        createdAt?: { gte?: Date; lte?: Date };
      } = scopedPiiWhere(session);

      if (technicianId) where.technicianId = technicianId;
      if (action) where.action = action;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = new Date(from);
        if (to) where.createdAt.lte = new Date(to);
      }

      const db = getRlsDb();
      const logs = await db.auditLog.findMany({
        where,
        include: { technician: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });

      const entries = logs.map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        technicianId: log.technicianId,
        technicianName: log.technician?.name ?? null,
        metadata: parseMetadata(log.metadata),
        ipAddress: log.ipAddress,
        createdAt: log.createdAt.toISOString(),
        entryHash: log.entryHash || null,
        promptVersion: log.promptVersion,
      }));

      // Phase 6.2 — fail-closed audit of compliance log access
      await writeAuditedAccess({
        action: 'audit.access',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'auditLog',
        entityId: session.dealershipId,
        metadata: {
          format: format || 'json',
          resultCount: entries.length,
          filters: { technicianId: technicianId || null, action: action || null },
        },
        ipAddress: getRequestIp(request),
      });

      if (format === 'csv') {
        const header = [
          'id',
          'action',
          'technicianName',
          'entityType',
          'entityId',
          'ipAddress',
          'createdAt',
          'entryHash',
          'promptVersion',
          'metadata',
        ];
        const rows = entries.map((entry) =>
          [
            entry.id,
            entry.action,
            entry.technicianName,
            entry.entityType,
            entry.entityId,
            entry.ipAddress,
            entry.createdAt,
            entry.entryHash,
            entry.promptVersion,
            JSON.stringify(entry.metadata),
          ]
            .map(toCsvValue)
            .join(',')
        );
        const csv = [header.join(','), ...rows].join('\n');
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="audit-logs-${Date.now()}.csv"`,
          },
        });
      }

      return { logs: entries, count: entries.length };
    },
    {
      rateLimitKey: 'audit-logs.list',
      requireManager: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}