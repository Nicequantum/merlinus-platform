import 'server-only';

import { publishCompanionEvent } from '@/lib/companionHub';
import type { CompanionEvent } from '@/lib/companionSyncTypes';

type BroadcastCompanionEvent = {
  [K in CompanionEvent as K['type']]: Omit<
    K,
    'seq' | 'timestamp' | 'technicianId' | 'sourceDeviceId' | 'id'
  > & {
    type: K['type'];
    id?: string;
    sourceDeviceId?: string;
  };
}[CompanionEvent['type']];

/** Broadcast from API routes after successful mutations. */
export async function broadcastCompanionEvent(
  technicianId: string,
  event: BroadcastCompanionEvent
): Promise<void> {
  await publishCompanionEvent(technicianId, event);
}