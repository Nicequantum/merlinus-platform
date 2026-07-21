import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { withPublicRoute } from '@/lib/apiRoute';
import { normalizeD7Number } from '@/lib/d7Number';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  generateRecoveryToken,
  hashRecoveryToken,
  isPasswordRecoveryEnabled,
  RECOVERY_GENERIC_MESSAGE,
  RECOVERY_TOKEN_TTL_MS,
  shouldReturnRecoveryTokenInResponse,
} from '@/lib/passwordRecovery';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  d7Number: z.string().trim().min(3).max(32),
  email: z.string().trim().email().max(200),
});

/**
 * P3-4 — Request password recovery (public, rate-limited, anti-enumeration).
 * Always returns the same message whether or not the account matched.
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

      const d7 = normalizeD7Number(parsed.data.d7Number);
      const email = parsed.data.email.trim().toLowerCase();

      let rawToken: string | undefined;

      await withRlsBypass(async () => {
        const tech = await getRlsDb().technician.findFirst({
          where: {
            d7Number: d7,
            email,
            isActive: true,
            deletedAt: null,
            role: { not: 'owner' }, // owners use platform ops / seed — not public recovery
          },
          select: { id: true, dealershipId: true, d7Number: true },
        });

        if (!tech) {
          logger.info('auth.password_recovery_request_nomatch', { d7Present: Boolean(d7) });
          return;
        }

        rawToken = generateRecoveryToken();
        const tokenHash = hashRecoveryToken(rawToken);
        const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_TTL_MS);

        // Invalidate prior unused tokens for this technician
        await getRlsDb().passwordRecoveryToken.updateMany({
          where: { technicianId: tech.id, usedAt: null },
          data: { usedAt: new Date() },
        });

        await getRlsDb().passwordRecoveryToken.create({
          data: {
            technicianId: tech.id,
            dealershipId: tech.dealershipId,
            tokenHash,
            expiresAt,
          },
        });

        logger.info('auth.password_recovery_token_created', {
          technicianId: tech.id,
          dealershipId: tech.dealershipId,
          expiresAt: expiresAt.toISOString(),
        });

        // Production: integrate email/SMS here. Until then, managers reset passwords
        // or staging enables MERLIN_PASSWORD_RECOVERY_RETURN_TOKEN for tablet QA.
      });

      const payload: Record<string, unknown> = {
        ok: true,
        message: RECOVERY_GENERIC_MESSAGE,
      };
      if (rawToken && shouldReturnRecoveryTokenInResponse()) {
        payload.recoveryToken = rawToken;
        payload.debug =
          'Token returned only because recovery debug/CI mode is on — never enable in production.';
      }
      return payload;
    },
    {
      rateLimitKey: 'auth.password_recovery.request',
      rateLimit: RATE_LIMITS.auth,
      skipCsrf: true,
    }
  );
}
