import { getRlsDb } from '@/lib/apex/rlsContext';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { mapAdvisorListItem, parseAdvisorProfileData } from '@/lib/advisorApiMappers';
import { computeAdvisorMetricsBatch } from '@/lib/advisorMetrics';
import { withAuth } from '@/lib/apiRoute';
import { decryptPII } from '@/lib/encryption';
import { readAdvisorDisplayNameFromDb, readRoNumberFromDb } from '@/lib/piiFieldRead';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { isServiceAdvisorActive } from '@/lib/serviceAdvisorAccounts';
import { parseRequestBody, parseRouteParams, routeIdParamsSchema, updateAdvisorSchema } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const advisor = await getRlsDb().serviceAdvisor.findFirst({
        where: { id, dealershipId: session.dealershipId, deletedAt: null },
        include: {
          profile: true,
          observations: {
            orderBy: { observedAt: 'desc' },
            take: 12,
            select: {
              id: true,
              lineLabel: true,
              vehicleFamily: true,
              vehicleMake: true,
              vehicleModel: true,
              observedAt: true,
              complaintTextEncrypted: true,
              repairOrder: { select: { roNumberEncrypted: true } },
            },
          },
        },
      });

      if (!advisor) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const metricsById = await computeAdvisorMetricsBatch(
        session.dealershipId,
        [advisor.id],
        new Map([[advisor.id, advisor.csiScore ?? null]])
      );
      const profileData = parseAdvisorProfileData(advisor.profile?.profileDataEncrypted);

      return {
        advisor: {
          id: advisor.id,
          displayName: readAdvisorDisplayNameFromDb(advisor),
          advisorCode: advisor.advisorCode,
          status: advisor.status as 'active' | 'inactive',
          roCount: advisor.roCount,
          firstSeenAt: advisor.firstSeenAt.toISOString(),
          lastSeenAt: advisor.lastSeenAt.toISOString(),
          createdAt: advisor.createdAt.toISOString(),
          metrics: metricsById.get(advisor.id)!,
          profile: advisor.profile
            ? {
                observationCount: advisor.profile.observationCount,
                profileVersion: advisor.profile.profileVersion,
                lastComputedAt: advisor.profile.lastComputedAt?.toISOString() ?? null,
                profileData,
              }
            : null,
          recentObservations: advisor.observations.map((obs) => ({
            id: obs.id,
            lineLabel: obs.lineLabel,
            roNumber: readRoNumberFromDb(obs.repairOrder),
            vehicleFamily: obs.vehicleFamily,
            vehicle: [obs.vehicleMake, obs.vehicleModel].filter(Boolean).join(' '),
            complaint: decryptPII(obs.complaintTextEncrypted),
            observedAt: obs.observedAt.toISOString(),
          })),
        },
      };
    },
    {
      rateLimitKey: 'advisors.get',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, updateAdvisorSchema);
      if ('error' in parsed) return parsed.error;

      const advisor = await getRlsDb().serviceAdvisor.findFirst({
        where: { id, dealershipId: session.dealershipId, deletedAt: null },
      });

      if (!advisor) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const updated = await getRlsDb().serviceAdvisor.update({
        where: { id },
        data: {
          status: parsed.data.status,
          ...(parsed.data.csiScore !== undefined ? { csiScore: parsed.data.csiScore } : {}),
        },
        include: {
          profile: {
            select: {
              observationCount: true,
              lastComputedAt: true,
              profileDataEncrypted: true,
            },
          },
        },
      });

      await writeAuditedAccess({
        action: parsed.data.status === 'active' ? 'advisor.reactivate' : 'advisor.deactivate',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'service_advisor',
        entityId: updated.id,
        metadata: {
          displayName: readAdvisorDisplayNameFromDb(updated),
          status: updated.status,
          csiScore: updated.csiScore,
        },
        ipAddress: getRequestIp(request),
      });

      const metricsById = await computeAdvisorMetricsBatch(
        session.dealershipId,
        [updated.id],
        new Map([[updated.id, updated.csiScore ?? null]])
      );

      return {
        advisor: mapAdvisorListItem(updated, metricsById.get(updated.id)!),
      };
    },
    {
      rateLimitKey: 'advisors.update',
      requireManager: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const advisor = await getRlsDb().serviceAdvisor.findFirst({
        where: { id, dealershipId: session.dealershipId },
      });

      if (!advisor) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      if (advisor.deletedAt) {
        return { ok: true };
      }

      const removedAt = new Date();
      await getRlsDb().serviceAdvisor.update({
        where: { id },
        data: {
          deletedAt: removedAt,
          status: 'inactive',
        },
      });

      await writeAuditedAccess({
        action: 'advisor.delete',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'service_advisor',
        entityId: id,
        metadata: {
          displayName: readAdvisorDisplayNameFromDb(advisor),
          softDelete: true,
          deletedAt: removedAt.toISOString(),
          wasActive: isServiceAdvisorActive(advisor),
        },
        ipAddress: getRequestIp(request),
      });

      return { ok: true };
    },
    {
      rateLimitKey: 'advisors.delete',
      requireManager: true,
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}