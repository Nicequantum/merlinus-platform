/**
 * POST /api/auth/mfa/self-recovery
 *
 * Password-gated MFA clear when authenticator/backup codes fail after key rotation.
 * Requires valid password. Does NOT require TOTP.
 *
 * Always allowed when MFA material is corrupt (unreadable ciphertext).
 * Optional broader unlock: MERLIN_MFA_PASSWORD_RECOVERY=true (ops break-glass).
 */
import { NextResponse } from 'next/server';
import { resolveUnifiedLogin } from '@/lib/apex/loginResolver';
import { isApexPlatformMode } from '@/lib/platformMode';
import { loginTechnician } from '@/lib/auth';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withPublicRoute } from '@/lib/apiRoute';
import { validateCsrfRequest } from '@/lib/csrf';
import { getDb } from '@/lib/db';
import { warmEncryptionKeyring } from '@/lib/encryption';
import { apiError, handleRouteError } from '@/lib/errors';
import {
  clearMfaEnrollmentForRecovery,
  inspectMfaMaterialHealth,
  isMfaEnabledForTechnician,
} from '@/lib/mfa/service';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

function passwordRecoveryEnvOpen(): boolean {
  const v = process.env.MERLIN_MFA_PASSWORD_RECOVERY?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(
    request,
    'auth.mfa.self-recovery',
    RATE_LIMITS.authMfa
  );
  if (rateLimited) return rateLimited;

  const csrfError = validateCsrfRequest(request);
  if (csrfError) return apiError(csrfError, 403);

  return withPublicRoute(
    request,
    async () => {
      try {
        await getDb();
        try {
          await warmEncryptionKeyring();
        } catch {
          // continue
        }

        const parsed = await parseRequestBody(
          request,
          bodySchema,
          AUTH_JSON_BODY_LIMIT_BYTES
        );
        if ('error' in parsed) return parsed.error;

        let technicianId = '';
        let dealershipId = '';

        if (isApexPlatformMode()) {
          const loginResult = await resolveUnifiedLogin(
            parsed.data.identifier,
            parsed.data.password
          );
          if (loginResult.status === 'invalid') {
            return apiError('Invalid credentials.', 401);
          }
          if (loginResult.status === 'success') {
            technicianId = loginResult.session.technicianId;
            dealershipId = loginResult.session.dealershipId || '';
          } else {
            technicianId = loginResult.technicianId;
          }
        } else {
          const session = await loginTechnician(
            parsed.data.identifier,
            parsed.data.password
          );
          if (!session) return apiError('Invalid credentials.', 401);
          technicianId = session.technicianId;
          dealershipId = session.dealershipId;
        }

        if (!technicianId) {
          return apiError('Invalid credentials.', 401);
        }

        const enabled = await isMfaEnabledForTechnician(technicianId);
        if (!enabled) {
          return NextResponse.json({
            ok: true,
            cleared: false,
            message: 'MFA is not enabled. Sign in with your password.',
          });
        }

        const health = await inspectMfaMaterialHealth(technicianId);
        if (!health.corrupt && !passwordRecoveryEnvOpen()) {
          return apiError(
            'Authenticator still appears readable. Use your authenticator app or a backup code. If you remain locked out after key rotation, ask ops to set MERLIN_MFA_PASSWORD_RECOVERY=true for one login cycle.',
            403
          );
        }

        await clearMfaEnrollmentForRecovery(
          technicianId,
          health.corrupt ? 'self_recovery_corrupt' : 'self_recovery_env_break_glass'
        );

        try {
          await writeAuditedAccess({
            action: 'auth.mfa_admin_reset',
            dealershipId: dealershipId || '',
            technicianId,
            entityType: 'technician',
            entityId: technicianId,
            ipAddress: getRequestIp(request),
            metadata: {
              stage: 'self_recovery',
              reason: health.corrupt ? 'corrupt' : 'env_break_glass',
            },
          });
        } catch {
          // best-effort
        }

        return NextResponse.json({
          ok: true,
          cleared: true,
          message:
            'MFA cleared. Sign in with your password, then re-enroll multi-factor authentication in Settings.',
        });
      } catch (error) {
        return handleRouteError(error, 'auth.mfa.self-recovery');
      }
    },
    {
      rateLimitKey: 'auth.mfa.self-recovery',
      rateLimit: RATE_LIMITS.authMfa,
    }
  );
}
