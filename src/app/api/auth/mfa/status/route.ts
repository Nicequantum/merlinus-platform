import { withAuth } from '@/lib/apiRoute';
import {
  buildMfaSessionFlags,
  isMfaEnforcementEnabled,
  parseMfaRequiredRoles,
} from '@/lib/mfa/policy';
import { getMfaStatusForTechnician } from '@/lib/mfa/service';

export const dynamic = 'force-dynamic';

/** MFA status for the signed-in user (allowed while enrollment still required). */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const dbStatus = await getMfaStatusForTechnician(session.technicianId);
      const flags = buildMfaSessionFlags({
        role: session.role,
        isAdmin: session.isAdmin,
        mfaEnabled: dbStatus.mfaEnabled,
        mfaEnrolledAt: dbStatus.enrolledAt,
      });
      return {
        enforcementEnabled: isMfaEnforcementEnabled(),
        requiredRoles: [...parseMfaRequiredRoles()],
        mfaEnabled: flags.mfaEnabled,
        mfaEnrolled: flags.mfaEnrolled,
        mfaRequired: flags.mfaRequired,
        enrolledAt: dbStatus.enrolledAt,
        backupCodesRemaining: dbStatus.backupCodesRemaining,
        role: session.role,
        accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 15 * 60,
      };
    },
    {
      rateLimitKey: 'auth.mfa.status',
      skipMfa: true,
      skipPasswordChange: true,
      skipConsent: true,
      skipLegalDisclaimer: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
