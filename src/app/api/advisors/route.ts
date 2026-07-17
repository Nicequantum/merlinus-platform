import { getRlsDb } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';
import { mapAdvisorListItem } from '@/lib/advisorApiMappers';
import { computeAdvisorMetricsBatch } from '@/lib/advisorMetrics';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import {
  AdvisorManagementError,
  createManualServiceAdvisor,
} from '@/lib/serviceAdvisorManagement';
import { isServiceAdvisorActive } from '@/lib/serviceAdvisorAccounts';
import { parseRequestBody, createAdvisorSchema } from '@/lib/validation';

const advisorListInclude = {
  profile: {
    select: {
      observationCount: true,
      lastComputedAt: true,
      profileDataEncrypted: true,
    },
  },
} as const;

export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const db = getRlsDb();
      const advisors = await db.serviceAdvisor.findMany({
        where: {
          dealershipId: session.dealershipId,
          deletedAt: null,
        },
        orderBy: { lastSeenAt: 'desc' },
        include: advisorListInclude,
      });

      const csiByAdvisorId = new Map(
        advisors.map((advisor) => [advisor.id, advisor.csiScore ?? null] as const)
      );
      const metricsById = await computeAdvisorMetricsBatch(
        session.dealershipId,
        advisors.map((advisor) => advisor.id),
        csiByAdvisorId
      );

      return {
        advisors: advisors.map((advisor) =>
          mapAdvisorListItem(advisor, metricsById.get(advisor.id)!)
        ),
      };
    },
    {
      rateLimitKey: 'advisors.list',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, createAdvisorSchema);
      if ('error' in parsed) return parsed.error;

      try {
        const { advisor, reactivated } = await createManualServiceAdvisor(session.dealershipId, {
          displayName: parsed.data.displayName,
          advisorCode: parsed.data.advisorCode,
        });

        const metricsById = await computeAdvisorMetricsBatch(session.dealershipId, [advisor.id], new Map([[advisor.id, advisor.csiScore ?? null]]));

        await writeAuditedAccess({
          action: reactivated ? 'advisor.reactivate' : 'advisor.create',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'service_advisor',
          entityId: advisor.id,
          metadata: {
            displayName: readAdvisorDisplayNameFromDb(advisor),
            advisorCode: advisor.advisorCode,
            manual: true,
            reactivated,
          },
          ipAddress: getRequestIp(request),
        });

        const withProfile = await getRlsDb().serviceAdvisor.findUniqueOrThrow({
          where: { id: advisor.id },
          include: advisorListInclude,
        });

        return {
          advisor: mapAdvisorListItem(withProfile, metricsById.get(advisor.id)!),
        };
      } catch (error) {
        if (error instanceof AdvisorManagementError) {
          return apiError(error.message, error.status);
        }
        throw error;
      }
    },
    {
      rateLimitKey: 'advisors.create',
      requireManager: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}