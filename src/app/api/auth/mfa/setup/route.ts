/**
 * POST /api/auth/mfa/setup — generate TOTP secret + QR (alias of enroll with luxury payload).
 */
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { beginMfaEnrollment } from '@/lib/mfa/service';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { getRequestIp } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** When true, rotate secret even if already enrolled (requires re-verify). */
  rotate: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      // Bay technicians: MFA setup allowed but not required (optional hardening).
      try {
        const account =
          session.d7Number || session.name || session.technicianId;
        const result = await beginMfaEnrollment({
          technicianId: session.technicianId,
          accountName: account,
          rotate: parsed.data.rotate,
        });

        try {
          await writeAuditedAccess({
            action: 'auth.mfa_enroll_start',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: session.technicianId,
            ipAddress: getRequestIp(request),
            metadata: { rotate: Boolean(parsed.data.rotate) },
          });
        } catch {
          // non-critical for enroll start
        }

        return {
          secret: result.secret,
          otpauthUrl: result.otpauthUrl,
          qrCodeDataUrl: result.qrCodeDataUrl ?? null,
          message:
            'Scan the QR code with your authenticator app, then POST /api/auth/mfa/verify with a 6-digit code.',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(message, 400);
      }
    },
    {
      rateLimitKey: 'auth.mfa.setup',
      rateLimit: RATE_LIMITS.authMfa,
      skipMfa: true,
      skipPasswordChange: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
