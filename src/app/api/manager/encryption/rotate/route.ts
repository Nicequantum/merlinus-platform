/**
 * Encryption key rotation control plane (manager/owner).
 *
 * GET  — status (fingerprints + active rotation progress)
 * POST — { action: rotate-in-app | begin | confirm-env | start-reencrypt | cancel | finalize }
 *
 * Primary path: `rotate-in-app` — generates DEK, stores wrapped keyring, starts re-encrypt.
 * No Worker secret edits. Legacy begin/confirm-env remain for advanced ops.
 */
import { isPlatformOperator } from '@/lib/apex/platformOperator';
import { withAuth } from '@/lib/apiRoute';
import { apiError } from '@/lib/errors';
import {
  cancelEncryptionRotation,
  confirmEncryptionEnvKey,
  getRotationStatusBundle,
  rotateEncryptionKeysInApp,
  startReencryptPass,
} from '@/lib/encryption/rotationService';
import { finalizeInAppDekRotation } from '@/lib/encryption/keyring';
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
  action: z.enum([
    'rotate-in-app',
    'begin',
    'confirm-env',
    'start-reencrypt',
    'cancel',
    'finalize',
  ]),
  rotationId: z.string().trim().min(1).max(64).optional(),
  /** Legacy: pasted new key for confirm-env only — never persisted */
  newKey: z.string().min(32).max(256).optional(),
  startReencrypt: z.boolean().optional(),
});

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, postSchema, AUTH_JSON_BODY_LIMIT_BYTES);
      if ('error' in parsed) return parsed.error;

      // Platform-global DEK: only explicit platform operators may mutate key material.
      // Managers may still GET status (cadence / progress) without rotating.
      if (!(await isPlatformOperator(session.technicianId))) {
        return apiError(
          'Encryption key rotation is restricted to platform operators (APEX_PLATFORM_OWNER_EMAILS / seed owner).',
          403
        );
      }

      try {
        if (parsed.data.action === 'rotate-in-app' || parsed.data.action === 'begin') {
          // `begin` maps to in-app rotate (no env copy step — raw DEK never returned).
          const result = await rotateEncryptionKeysInApp({
            technicianId: session.technicianId,
            dealershipId: session.dealershipId,
          });
          return {
            ok: true,
            action: 'rotate-in-app',
            rotation: result.rotation,
            primaryFingerprint: result.primaryFingerprint,
            previousKeyFingerprint: result.previousKeyFingerprint,
            message: result.message,
            // Deliberately omit newKey — never send DEK material to the browser.
          };
        }

        if (parsed.data.action === 'confirm-env') {
          if (!parsed.data.newKey) {
            return apiError('newKey is required for confirm-env (legacy env path)', 400);
          }
          const result = await confirmEncryptionEnvKey({
            technicianId: session.technicianId,
            dealershipId: session.dealershipId,
            rotationId: parsed.data.rotationId,
            newKey: parsed.data.newKey,
            startReencrypt: parsed.data.startReencrypt !== false,
          });
          return {
            ok: true,
            action: 'confirm-env',
            ...result,
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

        if (parsed.data.action === 'finalize') {
          await finalizeInAppDekRotation();
          const bundle = await getRotationStatusBundle();
          return {
            ok: true,
            action: 'finalize',
            message: 'Previous data key retired. Dual-key window closed.',
            keys: bundle.keys,
            rotation: bundle.rotation,
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
