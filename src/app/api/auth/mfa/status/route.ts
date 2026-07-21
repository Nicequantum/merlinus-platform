import { withAuth } from '@/lib/apiRoute';
import {
  buildMfaSessionFlags,
  isMfaEnforcementEnabled,
  parseMfaRequiredRoles,
} from '@/lib/mfa/policy';

export const dynamic = 'force-dynamic';

/** P1-3 — MFA status for the signed-in user (allowed while enrollment still required). */
export async function GET(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const flags = buildMfaSessionFlags({
        role: session.role,
        isAdmin: session.isAdmin,
        mfaEnabled: session.mfaEnabled,
        mfaEnrolledAt: session.mfaEnrolled ? new Date() : null,
      });
      return {
        enforcementEnabled: isMfaEnforcementEnabled(),
        requiredRoles: [...parseMfaRequiredRoles()],
        mfaEnabled: flags.mfaEnabled,
        mfaEnrolled: flags.mfaEnrolled,
        mfaRequired: flags.mfaRequired,
        role: session.role,
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
