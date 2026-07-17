import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { hashPassword } from '@/lib/auth';
import { apiError, NOT_FOUND_ERROR } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { revokeSessionsAfterCredentialChange } from '@/lib/sessionRevocation';
import { parseRequestBody, parseRouteParams, resetPasswordSchema, routeIdParamsSchema } from '@/lib/validation';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const routeParams = await parseRouteParams(routeIdParamsSchema, params);
  if ('error' in routeParams) return routeParams.error;
  const { id } = routeParams.data;

  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, resetPasswordSchema);
      if ('error' in parsed) return parsed.error;

      const user = await getRlsDb().technician.findFirst({
        where: { id, dealershipId: session.dealershipId },
      });

      if (!user) {
        return apiError(NOT_FOUND_ERROR, 404);
      }

      const passwordHash = await hashPassword(parsed.data.newPassword);
      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));

      await getRlsDb().technician.update({
        where: { id },
        data: {
          passwordHash,
          // Phase 6.1 — force rotation on next login (same gate as provisioned managers).
          mustChangePassword: true,
          passwordChangedAt: null,
          ...dealerFields,
        },
      });

      // Phase 6.3 — full fortress revoke after admin password reset
      await revokeSessionsAfterCredentialChange(user.id);

      await writeAuditedAccess({
        action: 'user.password_reset',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: user.id,
        metadata: { d7Number: user.d7Number, sessionRevoked: true },
        ipAddress: getRequestIp(request),
      });

      return { ok: true };
    },
    { rateLimitKey: 'users.reset-password', requireManager: true }
  );
}