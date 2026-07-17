import type { Prisma } from '@prisma/client';
import { withOptionalDealerId } from '@/lib/apex/dealerScope';
import { scopedPiiWhere, type TenantScopedSession } from '@/lib/apex/tenantScope';
import {
  effectiveRole,
  effectiveServiceAdvisorId,
  type ViewAsSessionFields,
} from '@/lib/apex/viewAs';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { getAuditDashboardSummary } from '@/lib/auditSummary';
import { readRoNumberFromDb } from '@/lib/piiFieldRead';

function buildRoleScopedRoWhere(
  session: TenantScopedSession & {
    technicianId: string;
    serviceAdvisorId: string | null;
  } & ViewAsSessionFields
): Prisma.RepairOrderWhereInput {
  const piiScope = scopedPiiWhere(session);
  const role = effectiveRole(session);
  const advisorId = effectiveServiceAdvisorId(session);
  if (role === 'manager' || role === 'owner') {
    return withOptionalDealerId({ dealershipId: piiScope.dealershipId }, piiScope.dealerId);
  }
  if (role === 'service_advisor' && advisorId) {
    return withOptionalDealerId(
      {
        dealershipId: piiScope.dealershipId,
        serviceAdvisorId: advisorId,
      },
      piiScope.dealerId
    );
  }
  return withOptionalDealerId(
    { dealershipId: piiScope.dealershipId, technicianId: session.technicianId },
    piiScope.dealerId
  );
}

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const { dealershipId } = scopedPiiWhere(session);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const role = effectiveRole(session);
      const isManager = role === 'manager' || role === 'owner';
      const roWhere = buildRoleScopedRoWhere(session);

      const db = getRlsDb();
      const [totalRos, storiesGenerated, activeTechnicians, recentRos, auditSummary] = await Promise.all([
        db.repairOrder.count({ where: roWhere }),
        db.repairLine.count({
          where: {
            warrantyStoryEncrypted: { not: null },
            NOT: { warrantyStoryEncrypted: '' },
            repairOrder: roWhere,
          },
        }),
        isManager
          ? db.technician.count({ where: { dealershipId, isActive: true, deletedAt: null } })
          : Promise.resolve(0),
        db.repairOrder.findMany({
          where: roWhere,
          include: {
            technician: { select: { name: true } },
            repairLines: { select: { warrantyStoryEncrypted: true } },
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
        }),
        isManager
          ? getAuditDashboardSummary({ dealershipId, dealerId: session.dealerId })
          : null,
      ]);

      const auditScope = scopedPiiWhere(session);
      const activityThisWeek = await db.auditLog.count({
        where: isManager
          ? { ...auditScope, createdAt: { gte: weekAgo } }
          : { ...auditScope, technicianId: session.technicianId, createdAt: { gte: weekAgo } },
      });

      return {
        role,
        stats: {
          totalRepairOrders: totalRos,
          warrantyStories: storiesGenerated,
          activeTechnicians,
          auditEventsThisWeek: activityThisWeek,
        },
        recentRepairOrders: recentRos.map((ro) => ({
          id: ro.id,
          roNumber: readRoNumberFromDb(ro),
          year: ro.year,
          make: ro.make,
          model: ro.model,
          technicianName: ro.technician.name,
          lineCount: ro.repairLines.length,
          hasStories: ro.repairLines.some((l) => Boolean(l.warrantyStoryEncrypted)),
          updatedAt: ro.updatedAt.toISOString(),
        })),
        audit: auditSummary,
      };
    },
    { rateLimitKey: 'dashboard.summary', requireDealershipContext: true }
  );
}