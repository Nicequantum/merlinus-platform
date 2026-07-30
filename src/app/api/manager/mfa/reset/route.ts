/**
 * Admin MFA reset for a locked-out elevated user at the active rooftop.
 * Clears TOTP + backup codes and revokes their sessions.
 * Requires actor step-up TOTP (not backup codes) when actor has MFA enrolled.
 */
import { withAuth } from '@/lib/apiRoute';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { auditDealerIdFromSession } from '@/lib/audit';
import { apiError } from '@/lib/errors';
import {
  adminResetMfaForTechnician,
  isMfaEnabledForTechnician,
  verifyMfaFactor,
} from '@/lib/mfa/service';
import { getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  technicianId: z.string().trim().min(1).max(64),
  /** Optional note for audit (PII-free). */
  reason: z.string().trim().max(200).optional(),
  /** Actor step-up TOTP (6 digits). Required when actor has MFA enrolled. */
  actorTotpCode: z.string().trim().min(6).max(12).optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const actorHasMfa = await isMfaEnabledForTechnician(session.technicianId);
      if (actorHasMfa) {
        const code = parsed.data.actorTotpCode?.trim() || '';
        if (!code) {
          return apiError(
            'Enter your authenticator code to reset another user MFA.',
            400
          );
        }
        // TOTP only — backup codes must not authorize wiping peers.
        if (code.includes('-') || code.length > 8) {
          return apiError('Use your authenticator app code (not a backup code) for admin MFA reset.', 400);
        }
        const stepUp = await verifyMfaFactor({
          technicianId: session.technicianId,
          code,
        });
        if (!stepUp.ok || stepUp.method !== 'totp') {
          return apiError(
            !stepUp.ok ? stepUp.error : 'Authenticator code required for admin MFA reset.',
            403
          );
        }
      }

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
          stepUp: actorHasMfa,
          stepUpMethod: actorHasMfa ? 'totp' : 'none',
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
