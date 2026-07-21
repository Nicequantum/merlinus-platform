import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withAuth } from '@/lib/apiRoute';
import { encryptSensitiveText } from '@/lib/encryption';
import { apiError } from '@/lib/errors';
import { buildOtpAuthUri, generateTotpSecret } from '@/lib/mfa/totp';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** When true, rotate secret even if already enrolled (requires re-verify). */
  rotate: z.boolean().optional(),
});

/**
 * P1-3 — Begin TOTP enrollment: returns otpauth URI + secret once.
 * Client must call POST /api/auth/mfa/verify with a valid code to activate.
 */
export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const secret = generateTotpSecret();
      const encrypted = encryptSensitiveText(secret);

      await withRlsBypass(async () => {
        await getRlsDb().technician.update({
          where: { id: session.technicianId },
          data: {
            mfaSecretEncrypted: encrypted,
            // Not fully enrolled until verify succeeds
            mfaEnabled: false,
            mfaEnrolledAt: null,
          },
        });
      });

      const account =
        session.d7Number ||
        session.name ||
        session.technicianId;
      const otpauthUrl = buildOtpAuthUri({
        secret,
        accountName: account,
        issuer: 'Merlinus',
      });

      return {
        secret,
        otpauthUrl,
        message: 'Scan with an authenticator app, then POST /api/auth/mfa/verify with a 6-digit code.',
      };
    },
    {
      rateLimitKey: 'auth.mfa.enroll',
      skipMfa: true,
      skipPasswordChange: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
