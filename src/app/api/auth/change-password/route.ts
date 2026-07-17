import { resolveDealerIdForWrite } from '@/lib/apex/dealerContext';
import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { clearSessionCookie, hashPassword, verifyPassword } from '@/lib/auth';
import { apiError } from '@/lib/errors';
import { getRequestIp } from '@/lib/rate-limit';
import { revokeAllSessionsForTechnician } from '@/lib/sessionRevocation';
import { changePasswordSchema, parseRequestBody } from '@/lib/validation';

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, changePasswordSchema);
      if ('error' in parsed) return parsed.error;

      // Phase 7.1 H1 — control-plane bypass for credential change (Technician RLS)
      const tech = await withRlsBypass(async () =>
        getRlsDb().technician.findFirst({
          where: { id: session.technicianId, dealershipId: session.dealershipId },
        })
      );
      if (!tech) {
        return apiError('Account not found.', 404);
      }

      const valid = await verifyPassword(parsed.data.currentPassword, tech.passwordHash);
      if (!valid) {
        return apiError('Current password is incorrect.', 401);
      }

      const passwordHash = await hashPassword(parsed.data.newPassword);
      const dealerFields = dealerIdWriteFields(resolveDealerIdForWrite({ session }));

      const forced = Boolean(tech.mustChangePassword);

      await withRlsBypass(async () =>
        getRlsDb().technician.updateMany({
          where: { id: session.technicianId, dealershipId: session.dealershipId },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            ...dealerFields,
          },
        })
      );

      // Phase 6.2 — full fortress revocation (JWT version + apex refresh + Clerk)
      await revokeAllSessionsForTechnician(session.technicianId);

      await writeAuditedAccess({
        action: 'auth.password_change',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: session.technicianId,
        ipAddress: getRequestIp(request),
        metadata: { sessionRevoked: true, forced },
      });

      await clearSessionCookie();
      return { ok: true, requiresReauth: true };
    },
    {
      rateLimitKey: 'auth.change-password',
      rateLimit: { limit: 5, windowMs: 60_000 },
      skipPasswordChange: true,
    }
  );
}