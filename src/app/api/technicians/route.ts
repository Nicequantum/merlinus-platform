import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { backfillCertifiedStoriesFromAudit } from '@/lib/technicianCertifiedStory';

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      await backfillCertifiedStoriesFromAudit(session.dealershipId);

      const db = getRlsDb();
      const technicians = await db.technician.findMany({
        where: { dealershipId: session.dealershipId, deletedAt: null },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          consentAt: true,
          legalDisclaimerAt: true,
          firstAppLaunchAt: true,
        },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });

      const storyCounts = await db.technicianCertifiedStory.groupBy({
        by: ['technicianId'],
        where: { dealershipId: session.dealershipId },
        _count: { _all: true },
        _max: { certifiedAt: true },
      });

      const countMap = new Map(
        storyCounts.map((row) => [
          row.technicianId,
          { count: row._count._all, lastCertifiedAt: row._max.certifiedAt },
        ])
      );

      return {
        technicians: technicians.map((tech) => {
          const stats = countMap.get(tech.id);
          const hasOnboardingRecord = Boolean(
            tech.consentAt || tech.legalDisclaimerAt || tech.firstAppLaunchAt
          );
          return {
            id: tech.id,
            d7Number: tech.d7Number,
            name: tech.name,
            role: tech.role,
            isActive: tech.isActive,
            createdAt: tech.createdAt.toISOString(),
            certifiedStoryCount: stats?.count ?? 0,
            lastCertifiedAt: stats?.lastCertifiedAt?.toISOString() ?? null,
            hasOnboardingRecord,
          };
        }),
      };
    },
    {
      rateLimitKey: 'technicians.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}