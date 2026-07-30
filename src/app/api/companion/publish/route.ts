import { withAuth } from '@/lib/apiRoute';
import { publishCompanionEvent } from '@/lib/companionHub';
import type { CompanionEvent, CompanionEventType } from '@/lib/companionSyncTypes';
import { getCompanionDeviceIdFromRequest } from '@/lib/companionPublish';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(128).optional().nullable();

/** Strict per-type payloads — no passthrough free-form blobs into KV. */
const companionPublishSchema = z.object({
  event: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('navigation'),
      id: z.string().max(64).optional(),
      view: z.string().trim().min(1).max(64),
      repairOrderId: idSchema,
      lineId: idSchema,
    }),
    z.object({
      type: z.literal('status'),
      id: z.string().max(64).optional(),
      status: z.string().trim().min(1).max(64),
      message: z.string().max(500).optional(),
      repairOrderId: idSchema,
      lineId: idSchema,
      progress: z.number().min(0).max(100).optional(),
    }),
    z.object({
      type: z.literal('activity'),
      id: z.string().max(64).optional(),
      label: z.string().trim().min(1).max(200),
      detail: z.string().max(500).optional(),
      repairOrderId: idSchema,
      lineId: idSchema,
    }),
    z.object({
      type: z.literal('ro.patch'),
      id: z.string().max(64).optional(),
      repairOrderId: z.string().trim().min(1).max(128),
      lineId: z.string().trim().min(1).max(128).optional(),
      // Cap nested patch size — peers refetch full RO; do not ship warranty stories via companion.
      linePatch: z
        .record(z.string().max(64), z.unknown())
        .refine((o) => JSON.stringify(o).length <= 8_000, 'linePatch too large')
        .optional(),
      roPatch: z
        .object({
          roNumber: z.string().max(64).optional(),
          complaints: z.array(z.string().max(2000)).max(40).optional(),
          vehicle: z.record(z.string().max(64), z.unknown()).optional(),
          customer: z.record(z.string().max(64), z.unknown()).optional(),
        })
        .strict()
        .optional(),
      updatedAt: z.string().max(64).optional(),
    }),
  ]),
});

const CLIENT_ALLOWED: Set<CompanionEventType> = new Set([
  'navigation',
  'status',
  'activity',
  'ro.patch',
]);

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      const parsed = await parseRequestBody(request, companionPublishSchema);
      if ('error' in parsed) return parsed.error;

      const raw = parsed.data.event as Record<string, unknown>;
      const type = raw.type as CompanionEventType;
      if (!CLIENT_ALLOWED.has(type)) {
        return new Response('Event type not allowed from client', { status: 400 });
      }

      // Never accept warrantyStory / story text through companion fan-out.
      if (raw.linePatch && typeof raw.linePatch === 'object') {
        const lp = raw.linePatch as Record<string, unknown>;
        delete lp.warrantyStory;
        delete lp.storyText;
        delete lp.technicianNotes;
      }

      const deviceId = getCompanionDeviceIdFromRequest(request, raw);
      const event = await publishCompanionEvent(session.technicianId, {
        ...(raw as Omit<CompanionEvent, 'id' | 'timestamp' | 'technicianId' | 'sourceDeviceId' | 'seq'>),
        type,
        sourceDeviceId: deviceId,
      });

      return { ok: true, id: event.id };
    },
    {
      rateLimitKey: 'companion.publish',
      rateLimit: RATE_LIMITS.companionPublish,
      requireDealershipContext: true,
    }
  );
}
