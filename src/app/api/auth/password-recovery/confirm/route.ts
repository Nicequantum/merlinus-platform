import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withPublicRoute } from '@/lib/apiRoute';
import { hashPassword } from '@/lib/auth';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  hashRecoveryToken,
  isPasswordRecoveryEnabled,
} from '@/lib/passwordRecovery';
import { evaluatePasswordPolicy } from '@/lib/passwordPolicy';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { revokeAllSessionsForTechnician } from '@/lib/sessionRevocation';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().trim().min(20).max(128),
  newPassword: z.string().min(8).max(128),
});

/**
 * P3-4 — Confirm recovery with one-time token + new password.
 */
export async function POST(request: Request) {
  if (!isPasswordRecoveryEnabled()) {
    return apiError(
      'Self-service password recovery is not enabled. Contact your service manager.',
      403
    );
  }

  return withPublicRoute(
    request,
    async () => {
      const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      const tokenHash = hashRecoveryToken(parsed.data.token);

      const result = await withRlsBypass(async () => {
        const row = await getRlsDb().passwordRecoveryToken.findUnique({
          where: { tokenHash },
        });
        if (!row || row.usedAt) {
          return { error: 'This reset link is invalid or has already been used.' as const };
        }
        if (row.expiresAt.getTime() < Date.now()) {
          return { error: 'This reset link has expired. Request a new one.' as const };
        }

        const tech = await getRlsDb().technician.findUnique({
          where: { id: row.technicianId },
          select: { id: true, role: true, isAdmin: true, isActive: true, deletedAt: true },
        });
        if (!tech || !tech.isActive || tech.deletedAt) {
          return { error: 'Account is not available for reset.' as const };
        }

        const policy = evaluatePasswordPolicy(parsed.data.newPassword, {
          role: tech.role,
          elevated: tech.isAdmin,
        });
        if (!policy.ok) {
          return { error: policy.errors[0] || 'Password does not meet policy' as const };
        }

        const passwordHash = await hashPassword(parsed.data.newPassword);
        await getRlsDb().technician.update({
          where: { id: tech.id },
          data: {
            passwordHash,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
          },
        });

        await getRlsDb().passwordRecoveryToken.update({
          where: { id: row.id },
          data: { usedAt: new Date() },
        });

        return { technicianId: tech.id };
      });

      if ('error' in result) {
        return apiError(result.error || 'Password recovery failed', 400);
      }

      await revokeAllSessionsForTechnician(result.technicianId);
      logger.info('auth.password_recovery_completed', {
        technicianId: result.technicianId,
      });

      return {
        ok: true,
        message: 'Password updated. Sign in with your new password.',
        requiresReauth: true,
      };
    },
    {
      rateLimitKey: 'auth.password_recovery.confirm',
      rateLimit: RATE_LIMITS.auth,
      skipCsrf: true,
    }
  );
}
