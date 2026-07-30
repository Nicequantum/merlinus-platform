'use client';

import { Wifi, WifiOff, Smartphone } from 'lucide-react';
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
  /** Other devices signed into the same account (honest multi-device presence). */
  peerCount?: number;
  livePeer?: boolean;
}

export function CompanionConnectionBadge({
  state,
  peerCount = 0,
  livePeer = false,
}: CompanionConnectionBadgeProps) {
  const connected = state === 'connected';
  const multi = peerCount > 0 || livePeer;
  const label =
    connected && multi
      ? peerCount > 0
        ? `Live · ${peerCount + 1} devices`
        : 'Live · multi-device'
      : LABELS[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
        connected && multi
          ? 'text-benz-green border-benz-green/40 bg-benz-green/15'
          : connected
            ? 'text-benz-green border-benz-green/30 bg-benz-green/10'
            : state === 'reconnecting' || state === 'connecting'
              ? 'text-benz-amber border-benz-amber/30 bg-benz-amber/10'
              : 'text-benz-secondary border-benz-border bg-benz-surface'
      }`}
      title={
        multi
          ? 'Another device is signed into this account — edits sync live'
          : connected
            ? 'Connected — waiting for another device on this account'
            : undefined
      }
    >
      {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {multi ? <Smartphone size={11} /> : null}
      {label}
    </span>
  );
}
