import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';

/** Manager-only snapshot for verifying Phase 1 advisor capture during live testing. */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const dealershipId = session.dealershipId;

      const [advisorCount, observationCount, profileCount, linkedRos, recentAdvisors, recentCaptures] =
        await Promise.all([
          getRlsDb().serviceAdvisor.count({ where: { dealershipId, status: 'active', deletedAt: null } }),
          getRlsDb().advisorComplaintObservation.count({ where: { dealershipId } }),
          getRlsDb().advisorWritingProfile.count({
            where: { serviceAdvisor: { dealershipId } },
          }),
          getRlsDb().repairOrder.count({
            where: { dealershipId, serviceAdvisorId: { not: null } },
          }),
          getRlsDb().serviceAdvisor.findMany({
            where: { dealershipId, status: 'active', deletedAt: null },
            orderBy: { lastSeenAt: 'desc' },
            take: 8,
            select: {
              id: true,
              displayNameEncrypted: true,
              roCount: true,
              lastSeenAt: true,
              profile: {
                select: {
                  observationCount: true,
                  lastComputedAt: true,
                },
              },
            },
          }),
          getRlsDb().auditLog.findMany({
            where: { dealershipId, action: 'advisor.capture' },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: {
              id: true,
              createdAt: true,
              metadata: true,
            },
          }),
        ]);

      return {
        advisorIntelligence: {
          advisors: advisorCount,
          observations: observationCount,
          profiles: profileCount,
          linkedRepairOrders: linkedRos,
          recentAdvisors: recentAdvisors.map((advisor) => ({
            id: advisor.id,
            displayName: readAdvisorDisplayNameFromDb(advisor),
            roCount: advisor.roCount,
            lastSeenAt: advisor.lastSeenAt.toISOString(),
            observationCount: advisor.profile?.observationCount ?? 0,
            profileUpdatedAt: advisor.profile?.lastComputedAt?.toISOString() ?? null,
          })),
          recentCaptures: recentCaptures.map((entry) => ({
            id: entry.id,
            createdAt: entry.createdAt.toISOString(),
            metadata: JSON.parse(entry.metadata || '{}') as Record<string, unknown>,
          })),
        },
      };
    },
    { rateLimitKey: 'advisors.summary', requireManager: true }
  );
}