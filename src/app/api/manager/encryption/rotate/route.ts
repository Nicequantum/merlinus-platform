/**
 * Encryption key rotation control plane (manager/owner).
 *
 * GET  — status (fingerprints + active rotation progress)
 * POST — { action: begin | start-reencrypt | cancel }
 *
 * Keys are never stored in D1. `begin` returns a one-time new key for ops to
 * place into Worker secrets (PREVIOUS=old, KEY=new), then start-reencrypt walks PII.
 */
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import {
  beginEncryptionRotation,
  cancelEncryptionRotation,
  getRotationStatusBundle,
  startReencryptPass,
} from '@/lib/encryption/rotationService';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withAuth(
    request,
    async () => {
      const bundle = await getRotationStatusBundle();
      return {
        ok: true,
        ...bundle,
        // Never echo secrets
        secrets: undefined,
      };
    },
    {
      rateLimitKey: 'manager.encryption.status',
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}

const postSchema = z.object({
  action: z.enum(['begin', 'start-reencrypt', 'cancel']),
  rotationId: z.string().trim().min(1).max(64).optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, postSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      try {
        if (parsed.data.action === 'begin') {
          const result = await beginEncryptionRotation({
            technicianId: session.technicianId,
            dealershipId: session.dealershipId,
          });
          return {
            ok: true,
            action: 'begin',
            rotation: result.rotation,
            /** ONE-TIME — set as DATA_ENCRYPTION_KEY after PREVIOUS=current secret */
            newKey: result.newKey,
            previousKeyFingerprint: result.previousKeyFingerprint,
            newKeyFingerprint: result.newKeyFingerprint,
            warning:
              'Copy newKey now — it is not stored. Set DATA_ENCRYPTION_KEY_PREVIOUS to the old key and DATA_ENCRYPTION_KEY to newKey, then deploy.',
          };
        }

        if (parsed.data.action === 'start-reencrypt') {
          const rotation = await startReencryptPass({
            technicianId: session.technicianId,
            dealershipId: session.dealershipId,
            rotationId: parsed.data.rotationId,
          });
          return {
            ok: true,
            action: 'start-reencrypt',
            rotation,
            message: 'Background re-encryption started under dual-key decrypt.',
          };
        }

        const rotation = await cancelEncryptionRotation({
          technicianId: session.technicianId,
          dealershipId: session.dealershipId,
          rotationId: parsed.data.rotationId,
        });
        return { ok: true, action: 'cancel', rotation };
      } catch (error) {
        return apiError(error instanceof Error ? error.message : String(error), 400);
      }
    },
    {
      rateLimitKey: 'manager.encryption.rotate',
      rateLimit: RATE_LIMITS.authMfa,
      requireManager: true,
      requireDealershipContext: true,
    }
  );
}
