'use client';

import { Wifi, WifiOff } from 'lucide-react';
import type { CompanionConnectionState } from '@/lib/companionSyncTypes';

const LABELS: Record<CompanionConnectionState, string> = {
  connected: 'Live sync',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Offline',
  error: 'Sync error',
};

interface CompanionConnectionBadgeProps {
  state: CompanionConnectionState;
}

export function CompanionConnectionBadge({ state }: CompanionConnectionBadgeProps) {
  const connected = state === 'connected';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
        connected
          ? 'text-benz-green border-benz-green/30 bg-benz-green/10'
          : state === 'reconnecting' || state === 'connecting'
            ? 'text-benz-amber border-benz-amber/30 bg-benz-amber/10'
            : 'text-benz-secondary border-benz-border bg-benz-surface'
      }`}
    >
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {LABELS[state]}
    </span>
  );
}