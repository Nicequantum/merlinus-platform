/**
 * Admin MFA reset for a locked-out elevated user at the active rooftop.
 * Clears TOTP + backup codes and revokes their sessions.
 */
import { withAuth } from '@/lib/apiRoute';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { auditDealerIdFromSession } from '@/lib/audit';
import { apiError } from '@/lib/errors';
import { adminResetMfaForTechnician } from '@/lib/mfa/service';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  technicianId: z.string().trim().min(1).max(64),
  /** Optional note for audit (PII-free). */
  reason: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      let result: { targetName: string; targetRole: string };
      try {
        result = await adminResetMfaForTechnician({
          targetTechnicianId: parsed.data.technicianId,
          dealershipId: session.dealershipId,
          actorTechnicianId: session.technicianId,
        });
      } catch (error) {
        return apiError(error instanceof Error ? error.message : 'Could not reset MFA', 400);
      }

      await writeAuditedAccess({
        action: 'auth.mfa_admin_reset',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: parsed.data.technicianId,
        metadata: {
          targetRole: result.targetRole,
          reason: parsed.data.reason?.slice(0, 200) || null,
        },
        ipAddress: getRequestIp(request),
      });

      return {
        ok: true,
        message: `MFA cleared for ${result.targetName}. They must re-enroll at next login if enforcement is on.`,
        targetRole: result.targetRole,
      };
    },
    {
      rateLimitKey: 'manager.mfa.reset',
      rateLimit: RATE_LIMITS.authMfa,
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
