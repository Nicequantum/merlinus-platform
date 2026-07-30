/**
 * Self-service MFA disable — requires current TOTP or backup code.
 * Revokes all sessions so the next login is a clean single-factor session.
 */
import { withAuth } from '@/lib/apiRoute';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { auditDealerIdFromSession } from '@/lib/audit';
import { apiError } from '@/lib/errors';
import { disableMfaForTechnician } from '@/lib/mfa/service';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().min(6).max(32),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        await disableMfaForTechnician({
          technicianId: session.technicianId,
          code: parsed.data.code,
        });
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Could not disable MFA', 400);
      }

      await writeAuditedAccess({
        action: 'auth.mfa_disable',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: session.technicianId,
        metadata: { selfService: true },
        ipAddress: getRequestIp(request),
      });

      return {
        ok: true,
        mfaEnabled: false,
        message: 'MFA disabled. Sign in again — re-enroll when ready.',
        requiresReauth: true,
      };
    },
    {
      rateLimitKey: 'auth.mfa.disable',
      rateLimit: RATE_LIMITS.authMfa,
      skipMfa: true,
      skipPasswordChange: true,
    }
  );
}
