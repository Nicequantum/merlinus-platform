'use client';

import { useEffect, useRef } from 'react';
import { startBaySessionKeepAlive } from '@/lib/clientFetchRetry';
import { startVisibilityBayWarmup } from '@/lib/bayWarmup';
import type { TechnicianSession } from '@/types';

/**
 * Bay tablet cold-start hardening:
 * - Aggressive session + RO list warm on mount
 * - Interval keep-alive (pauses when tab hidden)
 * - Visibility / online resume re-warm
 */
export function useBayPrefetch(session: TechnicianSession | null): void {
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!session?.technicianId || !session.dealershipId) return;

    const stopKeepAlive = startBaySessionKeepAlive({
      intervalMs: 75_000,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
      aggressive: true,
    });
    const stopVisibility = startVisibilityBayWarmup({
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });

    stopRef.current = () => {
      stopKeepAlive();
      stopVisibility();
    };

    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [session?.technicianId, session?.dealershipId]);
}
