import { getRlsDb } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { parseRouteParams, routeIdParamsSchema } from '@/lib/validation';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const technician = await getRlsDb().technician.findFirst({
        where: { id, dealershipId: session.dealershipId, deletedAt: null },
        select: {
          id: true,
          d7Number: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          consentAt: true,
          consentVersion: true,
          legalDisclaimerAt: true,
          legalDisclaimerVersion: true,
          firstAppLaunchAt: true,
          firstAppLaunchSessionId: true,
        },
      });

      if (!technician) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const [certifiedStoryCount, lastCertified] = await Promise.all([
        getRlsDb().technicianCertifiedStory.count({
          where: { technicianId: id, dealershipId: session.dealershipId },
        }),
        getRlsDb().technicianCertifiedStory.findFirst({
          where: { technicianId: id, dealershipId: session.dealershipId },
          orderBy: { certifiedAt: 'desc' },
          select: { certifiedAt: true },
        }),
      ]);

      return {
        technician: {
          id: technician.id,
          d7Number: technician.d7Number,
          name: technician.name,
          role: technician.role,
          isActive: technician.isActive,
          createdAt: technician.createdAt.toISOString(),
          certifiedStoryCount,
          lastCertifiedAt: lastCertified?.certifiedAt.toISOString() ?? null,
          onboarding: {
            consentAt: technician.consentAt?.toISOString() ?? null,
            consentVersion: technician.consentVersion ?? null,
            legalDisclaimerAt: technician.legalDisclaimerAt?.toISOString() ?? null,
            legalDisclaimerVersion: technician.legalDisclaimerVersion ?? null,
            firstAppLaunchAt: technician.firstAppLaunchAt?.toISOString() ?? null,
            firstAppLaunchSessionId: technician.firstAppLaunchSessionId ?? null,
          },
        },
      };
    },
    { rateLimitKey: 'technicians.get', requireManager: true }
  );
}