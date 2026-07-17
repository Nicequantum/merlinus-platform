'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { getCompanionDeviceId } from '@/lib/companionDeviceId';
import { COMPANION_DEVICE_HEADER } from '@/lib/companionPublish';
import {
  companionRolePublishes,
  companionRoleSubscribes,
  type CompanionSyncRole,
} from '@/lib/companionSyncRole';
import { clientLog } from '@/lib/clientLog';
import type {
  CompanionActivityEntry,
  CompanionConnectionState,
  CompanionEvent,
  CompanionWorkflowStatus,
} from '@/lib/companionSyncTypes';
import type { AppView, RepairLine, StoryQualityResult } from '@/types';

const STREAM_URL = '/api/companion/stream';
const PUBLISH_URL = '/api/companion/publish';
const POLL_URL = '/api/companion/poll';
const MAX_ACTIVITY = 40;
const RECONNECT_MS = 2_000;
/** Poll only as SSE fallback — when connected, poll infrequently for missed events. */
const POLL_MS_CONNECTED = 15_000;
const POLL_MS_DISCONNECTED = 3_000;
const POLL_LOOKBACK_MS = 120_000;
/** Desktop companion full-RO refresh — was 2s (too aggressive / clobber risk). */
const RO_SNAPSHOT_MS = 8_000;

interface CompanionHandlers {
  onNavigation: (payload: {
    view: AppView;
    repairOrderId: string | null;
    lineId: string | null;
  }) => void | Promise<void>;
  onRORefresh: (repairOrderId: string) => void | Promise<void>;
  onROPatch: (payload: {
    repairOrderId: string;
    lineId?: string;
    linePatch?: Partial<RepairLine>;
  }) => void | Promise<void>;
  onStoryQuality: (payload: {
    repairOrderId: string;
    lineId: string;
    quality: StoryQualityResult;
  }) => void | Promise<void>;
  onStoryCertification: (payload: {
    repairOrderId: string;
    lineId: string;
    certifiedByName: string;
    certifiedAt: string;
    warrantyStory: string;
    storyHash?: string;
  }) => void | Promise<void>;
}

interface UseCompanionSyncOptions extends CompanionHandlers {
  enabled: boolean;
  role?: CompanionSyncRole;
}

export function useCompanionSync({
  enabled,
  role = 'full',
  onNavigation,
  onRORefresh,
  onROPatch,
  onStoryQuality,
  onStoryCertification,
}: UseCompanionSyncOptions) {
  const deviceId = getCompanionDeviceId();
  const [connectionState, setConnectionState] = useState<CompanionConnectionState>('disconnected');
  const [workflowStatus, setWorkflowStatus] = useState<CompanionWorkflowStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusProgress, setStatusProgress] = useState<number | null>(null);
  const [activities, setActivities] = useState<CompanionActivityEntry[]>([]);

  const seenIdsRef = useRef(new Set<string>());
  const applyingRemoteRef = useRef(false);
  const lastPublishedNavRef = useRef('');
  const lastPublishedStatusRef = useRef('');
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionGenerationRef = useRef(0);
  const lastPollAtRef = useRef(new Date(Date.now() - POLL_LOOKBACK_MS).toISOString());
  const canAutoPublish = companionRolePublishes(role);
  const isSubscriber = companionRoleSubscribes(role);

  const handlersRef = useRef({
    onNavigation,
    onRORefresh,
    onROPatch,
    onStoryQuality,
    onStoryCertification,
  });
  handlersRef.current = {
    onNavigation,
    onRORefresh,
    onROPatch,
    onStoryQuality,
    onStoryCertification,
  };

  const rememberEventId = useCallback((id: string) => {
    seenIdsRef.current.add(id);
  }, []);

  const pushActivity = useCallback((entry: CompanionActivityEntry) => {
    flushSync(() => {
      setActivities((prev) => {
        if (prev.some((item) => item.id === entry.id)) return prev;
        return [entry, ...prev].slice(0, MAX_ACTIVITY);
      });
    });
  }, []);

  const recordActivity = useCallback(
    (
      label: string,
      options?: { detail?: string; repairOrderId?: string | null; lineId?: string | null }
    ) => {
      pushActivity({
        id: crypto.randomUUID(),
        label,
        detail: options?.detail,
        timestamp: new Date().toISOString(),
        repairOrderId: options?.repairOrderId,
        lineId: options?.lineId,
      });
    },
    [pushActivity]
  );

  const shouldIgnoreEvent = useCallback(
    (event: CompanionEvent) => {
      if (seenIdsRef.current.has(event.id)) return true;
      if (event.sourceDeviceId === 'server') return false;
      // Only navigation echoes loop on the publishing device — all other events
      // must reach companion windows that share a browser device id.
      if (event.type === 'navigation' && event.sourceDeviceId === deviceId) return true;
      return false;
    },
    [deviceId]
  );

  const handleEvent = useCallback(
    async (event: CompanionEvent) => {
      if (shouldIgnoreEvent(event)) return;
      seenIdsRef.current.add(event.id);
      if (Date.parse(event.timestamp) >= Date.parse(lastPollAtRef.current)) {
        lastPollAtRef.current = event.timestamp;
      }

      const handlers = handlersRef.current;
      try {
      switch (event.type) {
        case 'navigation':
          applyingRemoteRef.current = true;
          try {
            lastPublishedNavRef.current = `${event.view}:${event.repairOrderId}:${event.lineId}`;
            await handlers.onNavigation({
              view: event.view,
              repairOrderId: event.repairOrderId,
              lineId: event.lineId,
            });
          } finally {
            applyingRemoteRef.current = false;
          }
          break;
        case 'ro.refresh':
          await handlers.onRORefresh(event.repairOrderId);
          break;
        case 'ro.patch':
          await handlers.onROPatch({
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
            linePatch: event.linePatch,
          });
          if (event.linePatch?.warrantyStory !== undefined) {
            pushActivity({
              id: `${event.id}:story`,
              label: 'Warranty story updated',
              timestamp: event.timestamp,
              repairOrderId: event.repairOrderId,
              lineId: event.lineId,
            });
          } else if (
            event.linePatch?.technicianNotes !== undefined ||
            event.linePatch?.customerConcern !== undefined
          ) {
            pushActivity({
              id: `${event.id}:line`,
              label: 'Line notes updated',
              timestamp: event.timestamp,
              repairOrderId: event.repairOrderId,
              lineId: event.lineId,
            });
          }
          break;
        case 'status':
          flushSync(() => {
            setWorkflowStatus(event.status);
            setStatusMessage(event.message ?? null);
            setStatusProgress(typeof event.progress === 'number' ? event.progress : null);
          });
          if (event.status !== 'idle' && event.message?.trim()) {
            pushActivity({
              id: `${event.id}:workflow`,
              label: event.message.trim(),
              timestamp: event.timestamp,
              repairOrderId: event.repairOrderId,
              lineId: event.lineId,
            });
          }
          break;
        case 'activity':
          pushActivity({
            id: event.id,
            label: event.label,
            detail: event.detail,
            timestamp: event.timestamp,
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
          });
          break;
        case 'story.quality':
          await handlers.onStoryQuality({
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
            quality: event.quality,
          });
          pushActivity({
            id: `${event.id}:audit`,
            label: `Audit complete (score: ${event.quality.score})`,
            timestamp: event.timestamp,
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
          });
          break;
        case 'story.certification':
          await handlers.onStoryCertification({
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
            certifiedByName: event.certifiedByName,
            certifiedAt: event.certifiedAt,
            warrantyStory: event.warrantyStory,
            storyHash: event.storyHash,
          });
          pushActivity({
            id: `${event.id}:cert`,
            label: 'Story certified',
            detail: event.certifiedByName,
            timestamp: event.timestamp,
            repairOrderId: event.repairOrderId,
            lineId: event.lineId,
          });
          break;
        default:
          break;
      }
      } catch (error) {
        clientLog.error('companion.event_handler_failed', {
          type: event.type,
          eventId: event.id,
          error,
        });
      }
    },
    [pushActivity, shouldIgnoreEvent]
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const postEvent = useCallback(
    async (event: Record<string, unknown>) => {
      try {
        const response = await fetch(PUBLISH_URL, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            [COMPANION_DEVICE_HEADER]: deviceId,
          },
          body: JSON.stringify({ event: { ...event, sourceDeviceId: deviceId } }),
        });
        if (!response.ok) {
          setConnectionState((state) => (state === 'connected' ? 'error' : state));
        }
      } catch {
        setConnectionState((state) => (state === 'connected' ? 'error' : state));
      }
    },
    [deviceId]
  );

  const publishNavigation = useCallback(
    (state: { view: AppView; repairOrderId: string | null; lineId: string | null }) => {
      if (!canAutoPublish) return;
      if (applyingRemoteRef.current) return;
      const key = `${state.view}:${state.repairOrderId}:${state.lineId}`;
      if (key === lastPublishedNavRef.current) return;
      lastPublishedNavRef.current = key;
      void postEvent({
        id: crypto.randomUUID(),
        type: 'navigation',
        view: state.view,
        repairOrderId: state.repairOrderId,
        lineId: state.lineId,
      });
    },
    [canAutoPublish, postEvent]
  );

  const publishStatus = useCallback(
    (
      status: CompanionWorkflowStatus,
      options?: {
        message?: string;
        progress?: number;
        repairOrderId?: string | null;
        lineId?: string | null;
      }
    ) => {
      const publishKey = `${status}:${options?.message ?? ''}:${options?.progress ?? ''}:${options?.repairOrderId ?? ''}:${options?.lineId ?? ''}`;
      if (canAutoPublish) {
        setWorkflowStatus(status);
        setStatusMessage(options?.message ?? null);
        setStatusProgress(typeof options?.progress === 'number' ? options.progress : null);
      }
      if (!canAutoPublish) return;
      if (publishKey === lastPublishedStatusRef.current) return;
      lastPublishedStatusRef.current = publishKey;
      const id = crypto.randomUUID();
      rememberEventId(id);
      void postEvent({
        id,
        type: 'status',
        status,
        message: options?.message,
        progress: options?.progress,
        repairOrderId: options?.repairOrderId,
        lineId: options?.lineId,
      });
    },
    [canAutoPublish, postEvent, rememberEventId]
  );

  const publishActivity = useCallback(
    (
      label: string,
      options?: { detail?: string; repairOrderId?: string | null; lineId?: string | null }
    ) => {
      const id = crypto.randomUUID();
      rememberEventId(id);
      void postEvent({
        id,
        type: 'activity',
        label,
        detail: options?.detail,
        repairOrderId: options?.repairOrderId,
        lineId: options?.lineId,
      });
      pushActivity({
        id,
        label,
        detail: options?.detail,
        timestamp: new Date().toISOString(),
        repairOrderId: options?.repairOrderId,
        lineId: options?.lineId,
      });
    },
    [postEvent, pushActivity, rememberEventId]
  );

  const publishROPatch = useCallback(
    (payload: { repairOrderId: string; lineId?: string; linePatch?: Partial<RepairLine> }) => {
      void postEvent({
        id: crypto.randomUUID(),
        type: 'ro.patch',
        ...payload,
      });
    },
    [postEvent]
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      if (cancelled) return;
      try {
        const since = encodeURIComponent(lastPollAtRef.current);
        const response = await fetch(`${POLL_URL}?since=${since}`, { credentials: 'include' });
        if (!response.ok) return;
        const payload = (await response.json()) as { events?: CompanionEvent[] };
        const events = payload.events ?? [];
        for (const event of events) {
          await handleEventRef.current(event);
          const eventMs = Date.parse(event.timestamp);
          const cursorMs = Date.parse(lastPollAtRef.current);
          if (!Number.isNaN(eventMs) && eventMs >= cursorMs) {
            lastPollAtRef.current = new Date(eventMs + 1).toISOString();
          }
        }
      } catch (error) {
        clientLog.warn('companion.poll_failed', { error });
      }
    };

    const armTimer = () => {
      if (timer) clearInterval(timer);
      // Prefer SSE when connected — poll is a slow safety net only.
      const ms =
        connectionState === 'connected' ? POLL_MS_CONNECTED : POLL_MS_DISCONNECTED;
      timer = setInterval(() => void poll(), ms);
    };

    void poll();
    armTimer();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [enabled, connectionState]);

  useEffect(() => {
    if (!enabled) {
      setConnectionState('disconnected');
      return;
    }

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      const generation = connectionGenerationRef.current + 1;
      connectionGenerationRef.current = generation;

      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }

      setConnectionState((s) => (s === 'connected' ? 'reconnecting' : 'connecting'));

      const source = new EventSource(STREAM_URL, { withCredentials: true });
      sourceRef.current = source;

      source.onopen = () => {
        if (cancelled || connectionGenerationRef.current !== generation) return;
        setConnectionState('connected');
      };

      source.onmessage = (message) => {
        if (cancelled || connectionGenerationRef.current !== generation) return;
        try {
          const payload = JSON.parse(message.data) as CompanionEvent | { type: 'connected' };
          if (payload.type === 'connected') return;
          void handleEventRef.current(payload as CompanionEvent);
        } catch {
          // ignore malformed SSE payloads
        }
      };

      source.onerror = () => {
        if (cancelled || connectionGenerationRef.current !== generation) return;
        source.close();
        if (sourceRef.current === source) {
          sourceRef.current = null;
        }
        setConnectionState('reconnecting');
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      connectionGenerationRef.current += 1;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      sourceRef.current?.close();
      sourceRef.current = null;
      setConnectionState('disconnected');
    };
  }, [enabled]);

  return {
    deviceId,
    connectionState,
    workflowStatus,
    statusMessage,
    statusProgress,
    activities,
    publishNavigation,
    publishStatus,
    publishActivity,
    publishROPatch,
    recordActivity,
    isSubscriber,
    roSnapshotIntervalMs: RO_SNAPSHOT_MS,
  };
}