'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LiveConnectionState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'fallback';

export type ControlCenterLiveJob = {
  id: string;
  kind?: string;
  status?: string;
  progress?: number;
  phase?: string;
  technicianId?: string;
  errorMessage?: string | null;
  entityId?: string | null;
  updatedAt?: string;
};

export type ControlCenterLiveHealth = {
  overall: 'ok' | 'degraded' | 'error';
  maintenanceMode?: boolean;
  critical?: Array<{ id: string; label: string; status: string }>;
  updatedAt?: string;
};

export type ControlCenterLiveEvent =
  | { type: 'center.connected' | 'center.heartbeat'; timestamp?: string }
  | { type: 'job:updated'; job: ControlCenterLiveJob; timestamp?: string }
  | { type: 'health:changed'; health: ControlCenterLiveHealth; timestamp?: string }
  | { type: 'voice:activity'; voice?: { department?: string; preview?: string }; timestamp?: string }
  | { type: 'modules:changed'; modules?: { moduleId?: string; enabled?: boolean }; timestamp?: string };

export interface UseControlCenterLiveOptions {
  enabled?: boolean;
  /** Called on every parsed event */
  onEvent?: (event: ControlCenterLiveEvent) => void;
  /** Soft refresh summary when health/modules change */
  onNeedsRefresh?: () => void;
  /** Toast-worthy critical job failure */
  onJobFailed?: (job: ControlCenterLiveJob) => void;
  /** Health overall degraded/error */
  onHealthAlert?: (health: ControlCenterLiveHealth) => void;
}

const BASE_BACKOFF_MS = 1_200;
const MAX_BACKOFF_MS = 30_000;

/**
 * SSE live feed for Manager Control Center.
 * - Connects when enabled + tab visible
 * - Exponential backoff reconnect
 * - Falls back to polling signal via onNeedsRefresh when SSE fails repeatedly
 */
export function useControlCenterLive(options: UseControlCenterLiveOptions = {}): {
  connectionState: LiveConnectionState;
  lastEventAt: string | null;
  lastJob: ControlCenterLiveJob | null;
  lastHealth: ControlCenterLiveHealth | null;
  recentJobUpdates: ControlCenterLiveJob[];
  forceReconnect: () => void;
} {
  const enabled = options.enabled !== false;
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<ControlCenterLiveJob | null>(null);
  const [lastHealth, setLastHealth] = useState<ControlCenterLiveHealth | null>(null);
  const [recentJobUpdates, setRecentJobUpdates] = useState<ControlCenterLiveJob[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(BASE_BACKOFF_MS);
  const failCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const closeEs = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const handlePayload = useCallback((raw: string) => {
    try {
      const data = JSON.parse(raw) as ControlCenterLiveEvent & {
        type?: string;
        job?: ControlCenterLiveJob;
        health?: ControlCenterLiveHealth;
        timestamp?: string;
      };
      if (!data?.type) return;
      const ts = data.timestamp || new Date().toISOString();
      setLastEventAt(ts);

      if (data.type === 'center.heartbeat' || data.type === 'center.connected') {
        setConnectionState('live');
        failCountRef.current = 0;
        backoffRef.current = BASE_BACKOFF_MS;
        optionsRef.current.onEvent?.(data as ControlCenterLiveEvent);
        return;
      }

      if (data.type === 'job:updated' && data.job?.id) {
        const job: ControlCenterLiveJob = { ...data.job, updatedAt: ts };
        setLastJob(job);
        setRecentJobUpdates((prev) => {
          const next = [job, ...prev.filter((j) => j.id !== job.id)].slice(0, 40);
          return next;
        });
        if (job.status === 'failed') {
          optionsRef.current.onJobFailed?.(job);
        }
        optionsRef.current.onEvent?.({ type: 'job:updated', job, timestamp: ts });
        return;
      }

      if (data.type === 'health:changed' && data.health) {
        const health: ControlCenterLiveHealth = { ...data.health, updatedAt: ts };
        setLastHealth(health);
        if (health.overall !== 'ok') {
          optionsRef.current.onHealthAlert?.(health);
        }
        optionsRef.current.onEvent?.({ type: 'health:changed', health, timestamp: ts });
        optionsRef.current.onNeedsRefresh?.();
        return;
      }

      if (data.type === 'modules:changed' || data.type === 'voice:activity') {
        optionsRef.current.onEvent?.(data as ControlCenterLiveEvent);
        if (data.type === 'modules:changed') {
          optionsRef.current.onNeedsRefresh?.();
        }
      }
    } catch {
      // ignore malformed
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled || typeof EventSource === 'undefined') {
      setConnectionState('fallback');
      return;
    }
    if (!visibleRef.current) return;

    closeEs();
    setConnectionState((s) => (s === 'live' ? 'reconnecting' : 'connecting'));

    const es = new EventSource('/api/manager/center/live', { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      setConnectionState('live');
      failCountRef.current = 0;
      backoffRef.current = BASE_BACKOFF_MS;
    };

    es.onmessage = (ev) => {
      handlePayload(ev.data);
    };

    es.onerror = () => {
      closeEs();
      failCountRef.current += 1;
      if (failCountRef.current >= 4) {
        setConnectionState('fallback');
        optionsRef.current.onNeedsRefresh?.();
      } else {
        setConnectionState('reconnecting');
      }
      if (!visibleRef.current || !enabled) return;
      const delay = Math.min(
        MAX_BACKOFF_MS,
        backoffRef.current * (1 + Math.random() * 0.25)
      );
      backoffRef.current = Math.min(MAX_BACKOFF_MS, backoffRef.current * 1.8);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (visibleRef.current && enabled) connect();
      }, delay);
    };
  }, [closeEs, enabled, handlePayload]);

  const forceReconnect = useCallback(() => {
    failCountRef.current = 0;
    backoffRef.current = BASE_BACKOFF_MS;
    clearReconnectTimer();
    connect();
  }, [connect]);

  useEffect(() => {
    if (!enabled) {
      closeEs();
      setConnectionState('idle');
      return;
    }

    const onVis = () => {
      visibleRef.current = document.visibilityState === 'visible';
      if (visibleRef.current) {
        forceReconnect();
      } else {
        // Pause: close stream to save battery
        closeEs();
        clearReconnectTimer();
        setConnectionState('idle');
      }
    };

    visibleRef.current = document.visibilityState === 'visible';
    if (visibleRef.current) connect();
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearReconnectTimer();
      closeEs();
    };
  }, [closeEs, connect, enabled, forceReconnect]);

  return {
    connectionState,
    lastEventAt,
    lastJob,
    lastHealth,
    recentJobUpdates,
    forceReconnect,
  };
}
