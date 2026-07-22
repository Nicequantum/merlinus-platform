/**
 * POST /api/auth/mfa/enroll — begin TOTP enrollment (delegates to shared service / setup).
 */
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { beginMfaEnrollment } from '@/lib/mfa/service';
import { RATE_LIMITS, getRequestIp } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  rotate: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        const account = session.d7Number || session.name || session.technicianId;
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
            metadata: { rotate: Boolean(parsed.data.rotate), via: 'enroll' },
          });
        } catch {
          // best-effort
        }

        return {
          secret: result.secret,
          otpauthUrl: result.otpauthUrl,
          qrCodeDataUrl: result.qrCodeDataUrl ?? null,
          message:
            'Scan with an authenticator app, then POST /api/auth/mfa/verify with a 6-digit code.',
        };
      } catch (error) {
        return apiError(error instanceof Error ? error.message : String(error), 400);
      }
    },
    {
      rateLimitKey: 'auth.mfa.enroll',
      rateLimit: RATE_LIMITS.authMfa,
      skipMfa: true,
      skipPasswordChange: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
