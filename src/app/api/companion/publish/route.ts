import { withAuth } from '@/lib/apiRoute';
import { publishCompanionEvent } from '@/lib/companionHub';
import type { CompanionEvent, CompanionEventType } from '@/lib/companionSyncTypes';
import { getCompanionDeviceIdFromRequest } from '@/lib/companionPublish';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

const companionPublishSchema = z.object({
  event: z.object({
    type: z.string(),
    id: z.string().optional(),
  }).passthrough(),
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