import 'server-only';

import { randomUUID } from 'crypto';
import type { CompanionEvent } from '@/lib/companionSyncTypes';
import { logger } from '@/lib/logger';

type CompanionListener = (event: CompanionEvent) => void;

const listenersByTechnician = new Map<string, Set<CompanionListener>>();

const KV_QUEUE_MAX = 50;
const KV_QUEUE_TTL_SEC = 600;

function kvQueueKey(technicianId: string): string {
  return `companion:sse:${technicianId}`;
}

function notifyLocal(technicianId: string, event: CompanionEvent): void {
  const listeners = listenersByTechnician.get(technicianId);
  if (!listeners?.size) return;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('companion.listener_error', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }
}

async function persistToKv(technicianId: string, event: CompanionEvent): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      logger.warn('companion.kv_not_configured', {
        type: event.type,
        hint: 'Companion live sync requires KV_REST_API_URL and KV_REST_API_TOKEN in production',
      });
    }
    return;
  }
  try {
    const { kv } = await import('@vercel/kv');
    const key = kvQueueKey(technicianId);
    await kv.lpush(key, JSON.stringify(event));
    await kv.ltrim(key, 0, KV_QUEUE_MAX - 1);
    await kv.expire(key, KV_QUEUE_TTL_SEC);
  } catch (error) {
    logger.warn('companion.kv_persist_failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/** Subscribe to live companion events for a technician (in-process SSE connections). */
export function subscribeCompanionEvents(
  technicianId: string,
  listener: CompanionListener
): () => void {
  let set = listenersByTechnician.get(technicianId);
  if (!set) {
    set = new Set();
    listenersByTechnician.set(technicianId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listenersByTechnician.delete(technicianId);
  };
}

/** Publish a companion event to all connected devices for this technician. */
export async function publishCompanionEvent(
  technicianId: string,
  event: Omit<CompanionEvent, 'id' | 'timestamp' | 'technicianId' | 'sourceDeviceId' | 'seq'> & {
    id?: string;
    sourceDeviceId?: string;
  }
): Promise<CompanionEvent> {
  const envelope = {
    ...event,
    id: event.id ?? randomUUID(),
    technicianId,
    sourceDeviceId: event.sourceDeviceId ?? 'server',
    timestamp: new Date().toISOString(),
  } as CompanionEvent;

  notifyLocal(technicianId, envelope);
  await persistToKv(technicianId, envelope);
  return envelope;
}

/** Drain KV-backed events newer than the given ISO timestamp (cross-instance fan-out). */
export async function drainKvCompanionEvents(
  technicianId: string,
  sinceIso: string
): Promise<CompanionEvent[]> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return [];
  try {
    const { kv } = await import('@vercel/kv');
    const raw = await kv.lrange<string>(kvQueueKey(technicianId), 0, KV_QUEUE_MAX - 1);
    if (!raw?.length) return [];

    const sinceMs = Date.parse(sinceIso);
    const parsed: CompanionEvent[] = [];
    for (const item of raw) {
      try {
        const event = (typeof item === 'string' ? JSON.parse(item) : item) as CompanionEvent;
        if (Date.parse(event.timestamp) >= sinceMs) parsed.push(event);
      } catch {
        // skip malformed
      }
    }
    return parsed.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  } catch {
    return [];
  }
}