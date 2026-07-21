import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { decryptSensitiveText } from '@/lib/encryption';
import { apiError, VALIDATION_ERROR } from '@/lib/errors';
import { verifyTotpCode } from '@/lib/mfa/totp';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().min(6).max(12),
});

/**
 * P1-3 — Confirm TOTP enrollment or re-auth with current code.
 * On success sets mfaEnabled + mfaEnrolledAt.
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const tech = await withRlsBypass(async () =>
        getRlsDb().technician.findUnique({
          where: { id: session.technicianId },
          select: { mfaSecretEncrypted: true },
        })
      );

      if (!tech?.mfaSecretEncrypted) {
        return apiError('Start enrollment first via POST /api/auth/mfa/enroll.', 400);
      }

      let secret: string;
      try {
        secret = decryptSensitiveText(tech.mfaSecretEncrypted);
      } catch {
        return apiError('MFA secret could not be decrypted. Contact your administrator.', 500);
      }

      if (!verifyTotpCode(secret, parsed.data.code)) {
        return apiError('Invalid authentication code. Check your authenticator app.', 401);
      }

      await withRlsBypass(async () => {
        await getRlsDb().technician.update({
          where: { id: session.technicianId },
          data: {
            mfaEnabled: true,
            mfaEnrolledAt: new Date(),
          },
        });
      });

      return {
        ok: true,
        mfaEnabled: true,
        mfaEnrolled: true,
        message: 'Multi-factor authentication is now active for this account.',
      };
    },
    {
      rateLimitKey: 'auth.mfa.verify',
      skipMfa: true,
      skipPasswordChange: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
