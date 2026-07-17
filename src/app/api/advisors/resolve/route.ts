import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { resolveServiceAdvisor } from '@/lib/advisorIntelligence';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { parseRequestBody, resolveAdvisorSchema } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, resolveAdvisorSchema);
      if ('error' in parsed) return parsed.error;

      const resolved = await resolveServiceAdvisor(
        session.dealershipId,
        parsed.data.serviceAdvisorName
      );

      if (!resolved) {
        return apiError('Could not resolve a valid service advisor name', 400);
      }

      await writeAuditedAccess({
        action: 'advisor.resolve',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'serviceAdvisor',
        entityId: resolved.id,
        metadata: {
          displayName: resolved.displayName,
          isNew: resolved.isNew,
          matchedViaAlias: resolved.matchedViaAlias,
        },
        ipAddress: getRequestIp(request),
      });

      return { serviceAdvisor: resolved };
    },
    {
      rateLimitKey: 'advisors.resolve',
      requireDealershipContext: true,
      requireAuditedAccess: true,
    }
  );
}