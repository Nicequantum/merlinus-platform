'use client';

import { Radio } from 'lucide-react';
import type { CompanionWorkflowStatus } from '@/lib/companionSyncTypes';

interface LiveTechnicianSessionBadgeProps {
  active: boolean;
  workflowStatus?: CompanionWorkflowStatus;
  lastSeenAt?: string | null;
  deviceHint?: string | null;
}

/**
 * Shown when another device (bay tablet) is actively publishing on this session.
 */
export function LiveTechnicianSessionBadge({
  active,
  workflowStatus = 'idle',
  lastSeenAt,
  deviceHint,
}: LiveTechnicianSessionBadgeProps) {
  if (!active) return null;

  const ageSec = lastSeenAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(lastSeenAt)) / 1000))
    : null;
  const fresh = ageSec === null || ageSec < 45;
  if (!fresh) return null;

  const statusLabel =
    workflowStatus && workflowStatus !== 'idle'
      ? workflowStatus.replace(/_/g, ' ')
      : 'connected';

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-100 animate-pulse"
      title={
        deviceHint
          ? `Live bay session · ${deviceHint}`
          : 'Technician tablet is live on this repair order'
      }
    >
      <Radio size={12} className="shrink-0" aria-hidden />
      Live Technician Session
      <span className="font-normal opacity-80">· {statusLabel}</span>
    </span>
  );
}
