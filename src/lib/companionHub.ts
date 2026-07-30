import 'server-only';

import { randomUUID } from 'crypto';
import type { CompanionEvent } from '@/lib/companionSyncTypes';
import { logger } from '@/lib/logger';
import { getRateLimitKv } from '@/lib/storage/workersKv';

type CompanionListener = (event: CompanionEvent) => void;

const listenersByTechnician = new Map<string, Set<CompanionListener>>();

const KV_QUEUE_MAX = 80;
const KV_QUEUE_TTL_SEC = 900;
const PRESENCE_TTL_SEC = 90;

function kvQueueKey(technicianId: string): string {
  return `companion:sse:${technicianId}`;
}

function presenceKey(technicianId: string): string {
  return `companion:presence:${technicianId}`;
}

export type CompanionPresenceDevice = {
  deviceId: string;
  lastSeenAt: string;
  repairOrderId?: string | null;
  lineId?: string | null;
  label?: string;
};

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

async function readEventList(technicianId: string): Promise<CompanionEvent[]> {
  // Prefer Workers KV (production Cloudflare path)
  const workersKv = getRateLimitKv();
  if (workersKv) {
    try {
      const raw = await workersKv.get(kvQueueKey(technicianId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as CompanionEvent[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Legacy Vercel / Upstash REST
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return [];
  try {
    const { kv } = await import('@vercel/kv');
    const raw = await kv.lrange<string>(kvQueueKey(technicianId), 0, KV_QUEUE_MAX - 1);
    if (!raw?.length) return [];
    const out: CompanionEvent[] = [];
    for (const item of raw) {
      try {
        out.push((typeof item === 'string' ? JSON.parse(item) : item) as CompanionEvent);
      } catch {
        // skip
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function persistToKv(technicianId: string, event: CompanionEvent): Promise<void> {
  const workersKv = getRateLimitKv();
  if (workersKv) {
    try {
      const existing = await readEventList(technicianId);
      const next = [event, ...existing.filter((e) => e.id !== event.id)].slice(0, KV_QUEUE_MAX);
      await workersKv.put(kvQueueKey(technicianId), JSON.stringify(next), {
        expirationTtl: KV_QUEUE_TTL_SEC,
      });
      return;
    } catch (error) {
      logger.warn('companion.workers_kv_persist_failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      // fall through to REST
    }
  }

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('companion.kv_not_configured', {
        type: event.type,
        hint: 'Companion live sync needs Workers KV_STORE binding or KV_REST_API_*',
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

  // Same-isolate SSE keeps full payload for live desktop companion typing.
  notifyLocal(technicianId, envelope);
  // Cross-isolate KV must not retain full warranty narratives (PII blast on KV dump).
  await persistToKv(technicianId, redactCompanionEventForKv(envelope));
  return envelope;
}

/** Strip long PII fields from durable companion queue; peers refetch RO for full story. */
function redactCompanionEventForKv(event: CompanionEvent): CompanionEvent {
  if (event.type === 'ro.patch') {
    const linePatch = event.linePatch
      ? { ...event.linePatch }
      : undefined;
    if (linePatch) {
      const hadStory =
        typeof (linePatch as { warrantyStory?: string }).warrantyStory === 'string' &&
        Boolean((linePatch as { warrantyStory?: string }).warrantyStory?.trim());
      delete (linePatch as { warrantyStory?: string }).warrantyStory;
      delete (linePatch as { storyText?: string }).storyText;
      delete (linePatch as { technicianNotes?: string }).technicianNotes;
      if (hadStory) {
        (linePatch as { storyUpdated?: boolean }).storyUpdated = true;
      }
    }
    return { ...event, linePatch };
  }
  if (event.type === 'story.certification') {
    // Keep hash + metadata; force peer to hydrate body from RO API if missing.
    return {
      ...event,
      warrantyStory: event.warrantyStory?.slice(0, 0) ?? '',
    };
  }
  return event;
}

/** Drain KV-backed events newer than the given ISO timestamp (cross-instance fan-out). */
export async function drainKvCompanionEvents(
  technicianId: string,
  sinceIso: string
): Promise<CompanionEvent[]> {
  const list = await readEventList(technicianId);
  if (!list.length) return [];
  const sinceMs = Date.parse(sinceIso);
  return list
    .filter((event) => {
      const ts = Date.parse(event.timestamp);
      return !Number.isNaN(ts) && ts >= sinceMs;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

/** Heartbeat a device so peers can show honest multi-device presence. */
export async function touchCompanionPresence(
  technicianId: string,
  device: CompanionPresenceDevice
): Promise<CompanionPresenceDevice[]> {
  const workersKv = getRateLimitKv();
  let devices: CompanionPresenceDevice[] = [];

  if (workersKv) {
    try {
      const raw = await workersKv.get(presenceKey(technicianId));
      if (raw) {
        const parsed = JSON.parse(raw) as CompanionPresenceDevice[];
        if (Array.isArray(parsed)) devices = parsed;
      }
    } catch {
      devices = [];
    }
  } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      const raw = await kv.get<CompanionPresenceDevice[]>(presenceKey(technicianId));
      if (Array.isArray(raw)) devices = raw;
    } catch {
      devices = [];
    }
  } else {
    return [device];
  }

  const now = Date.now();
  const cutoff = now - PRESENCE_TTL_SEC * 1000;
  const map = new Map<string, CompanionPresenceDevice>();
  for (const d of devices) {
    if (Date.parse(d.lastSeenAt) >= cutoff) map.set(d.deviceId, d);
  }
  map.set(device.deviceId, { ...device, lastSeenAt: new Date().toISOString() });
  const next = Array.from(map.values());

  if (workersKv) {
    try {
      await workersKv.put(presenceKey(technicianId), JSON.stringify(next), {
        expirationTtl: PRESENCE_TTL_SEC * 2,
      });
    } catch {
      // ignore
    }
  } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      await kv.set(presenceKey(technicianId), next, { ex: PRESENCE_TTL_SEC * 2 });
    } catch {
      // ignore
    }
  }

  return next;
}

export async function listCompanionPresence(
  technicianId: string
): Promise<CompanionPresenceDevice[]> {
  const workersKv = getRateLimitKv();
  let devices: CompanionPresenceDevice[] = [];
  if (workersKv) {
    try {
      const raw = await workersKv.get(presenceKey(technicianId));
      if (raw) {
        const parsed = JSON.parse(raw) as CompanionPresenceDevice[];
        if (Array.isArray(parsed)) devices = parsed;
      }
    } catch {
      return [];
    }
  } else if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import('@vercel/kv');
      const raw = await kv.get<CompanionPresenceDevice[]>(presenceKey(technicianId));
      if (Array.isArray(raw)) devices = raw;
    } catch {
      return [];
    }
  }
  const cutoff = Date.now() - PRESENCE_TTL_SEC * 1000;
  return devices.filter((d) => Date.parse(d.lastSeenAt) >= cutoff);
}
