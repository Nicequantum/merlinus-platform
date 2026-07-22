/**
 * POST /api/auth/mfa/verify — confirm enrollment (enable MFA + backup codes).
 * Also used to re-auth with TOTP after setup.
 */
import { NextResponse } from 'next/server';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { clearSessionCookie } from '@/lib/auth';
import { clearApexSessionCookies } from '@/lib/apex/apexSession';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import { confirmMfaEnrollment } from '@/lib/mfa/service';
import { RATE_LIMITS, getRequestIp } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  code: z.string().trim().min(6).max(16),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        const { backupCodes } = await confirmMfaEnrollment({
          technicianId: session.technicianId,
          code: parsed.data.code,
          revokeSessions: true,
        });

        await writeAuditedAccess({
          action: 'auth.mfa_enroll_complete',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'technician',
          entityId: session.technicianId,
          ipAddress: getRequestIp(request),
          metadata: { backupCodesIssued: backupCodes.length, sessionsRevoked: true },
        });

        // Sessions revoked — client must re-login (and will hit MFA challenge).
        await clearSessionCookie();
        const response = NextResponse.json({
          ok: true,
          mfaEnabled: true,
          mfaEnrolled: true,
          requiresReauth: true,
          backupCodes,
          message:
            'Multi-factor authentication is active. Save your backup codes, then sign in again.',
        });
        clearApexSessionCookies(response);
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          await writeAuditedAccess({
            action: 'auth.mfa_failure',
            dealershipId: session.dealershipId,
            dealerId: auditDealerIdFromSession(session),
            technicianId: session.technicianId,
            entityType: 'technician',
            entityId: session.technicianId,
            ipAddress: getRequestIp(request),
            metadata: { stage: 'enroll_verify', error: message.slice(0, 120) },
          });
        } catch {
          // ignore
        }
        return apiError(message, message.includes('Invalid') ? 401 : 400);
      }
    },
    {
      rateLimitKey: 'auth.mfa.verify',
      rateLimit: RATE_LIMITS.authMfa,
      skipMfa: true,
      skipPasswordChange: true,
      requireDealershipContext: false,
      useRls: false,
    }
  );
}
