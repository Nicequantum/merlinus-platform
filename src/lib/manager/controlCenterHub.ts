/**
 * Manager Control Center — in-isolate live event bus (SSE fan-out).
 * Cross-isolate: SSE route also polls D1 / health for convergence.
 */

export type ControlCenterEventType =
  | 'center.connected'
  | 'center.heartbeat'
  | 'job:updated'
  | 'health:changed'
  | 'voice:activity'
  | 'modules:changed';

export interface ControlCenterEvent {
  type: ControlCenterEventType;
  dealershipId: string;
  timestamp: string;
  /** job:updated */
  job?: {
    id: string;
    kind?: string;
    status?: string;
    progress?: number;
    phase?: string;
    technicianId?: string;
    errorMessage?: string | null;
    entityId?: string | null;
  };
  /** health:changed */
  health?: {
    overall: 'ok' | 'degraded' | 'error';
    maintenanceMode?: boolean;
    critical?: Array<{ id: string; label: string; status: string }>;
  };
  /** voice:activity */
  voice?: {
    department?: string;
    preview?: string;
  };
  /** modules:changed */
  modules?: {
    moduleId?: string;
    enabled?: boolean;
  };
  message?: string;
}

type Listener = (event: ControlCenterEvent) => void;

/** dealershipId → listeners */
const listeners = new Map<string, Set<Listener>>();

/** Active SSE connection counts (approx, same isolate) */
const connectionCounts = new Map<string, number>();

/** jobId → dealershipId for fan-out without DB lookup */
const jobDealershipMap = new Map<string, string>();

const MAX_CONNECTIONS_PER_DEALERSHIP = 12;
const JOB_MAP_MAX = 5_000;

export function registerJobDealership(jobId: string, dealershipId: string): void {
  if (!jobId || !dealershipId) return;
  jobDealershipMap.set(jobId, dealershipId);
  if (jobDealershipMap.size > JOB_MAP_MAX) {
    const first = jobDealershipMap.keys().next().value;
    if (first) jobDealershipMap.delete(first);
  }
}

export function resolveJobDealership(jobId: string): string | null {
  return jobDealershipMap.get(jobId) ?? null;
}

export function getControlCenterConnectionCount(dealershipId: string): number {
  return connectionCounts.get(dealershipId) ?? 0;
}

export function getControlCenterMaxConnections(): number {
  return MAX_CONNECTIONS_PER_DEALERSHIP;
}

export function canAcceptControlCenterConnection(dealershipId: string): boolean {
  return getControlCenterConnectionCount(dealershipId) < MAX_CONNECTIONS_PER_DEALERSHIP;
}

export function trackControlCenterConnection(dealershipId: string): () => void {
  const n = (connectionCounts.get(dealershipId) ?? 0) + 1;
  connectionCounts.set(dealershipId, n);
  return () => {
    const next = (connectionCounts.get(dealershipId) ?? 1) - 1;
    if (next <= 0) connectionCounts.delete(dealershipId);
    else connectionCounts.set(dealershipId, next);
  };
}

export function publishControlCenterEvent(
  event: Omit<ControlCenterEvent, 'timestamp'> & { timestamp?: string }
): void {
  const full: ControlCenterEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
  const set = listeners.get(event.dealershipId);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(full);
    } catch {
      // never break producers
    }
  }
}

export function subscribeControlCenterEvents(
  dealershipId: string,
  listener: Listener
): () => void {
  let set = listeners.get(dealershipId);
  if (!set) {
    set = new Set();
    listeners.set(dealershipId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(dealershipId);
  };
}

export function controlCenterListenerCount(dealershipId: string): number {
  return listeners.get(dealershipId)?.size ?? 0;
}

/** Publish AI job update to managers watching this rooftop. */
export function publishJobUpdatedToCenter(input: {
  dealershipId?: string | null;
  jobId: string;
  kind?: string;
  status?: string;
  progress?: number;
  phase?: string;
  technicianId?: string;
  errorMessage?: string | null;
  entityId?: string | null;
}): void {
  const dealershipId =
    input.dealershipId?.trim() || resolveJobDealership(input.jobId) || '';
  if (!dealershipId) return;
  if (input.dealershipId) registerJobDealership(input.jobId, dealershipId);
  publishControlCenterEvent({
    type: 'job:updated',
    dealershipId,
    job: {
      id: input.jobId,
      kind: input.kind,
      status: input.status,
      progress: input.progress,
      phase: input.phase,
      technicianId: input.technicianId,
      errorMessage: input.errorMessage,
      entityId: input.entityId,
    },
  });
}

export function publishHealthChangedToCenter(input: {
  dealershipId: string;
  overall: 'ok' | 'degraded' | 'error';
  maintenanceMode?: boolean;
  critical?: Array<{ id: string; label: string; status: string }>;
}): void {
  publishControlCenterEvent({
    type: 'health:changed',
    dealershipId: input.dealershipId,
    health: {
      overall: input.overall,
      maintenanceMode: input.maintenanceMode,
      critical: input.critical,
    },
  });
}

export function publishVoiceActivityToCenter(input: {
  dealershipId: string;
  department?: string;
  preview?: string;
}): void {
  publishControlCenterEvent({
    type: 'voice:activity',
    dealershipId: input.dealershipId,
    voice: {
      department: input.department,
      preview: input.preview?.slice(0, 80),
    },
  });
}

export function publishModulesChangedToCenter(input: {
  dealershipId: string;
  moduleId?: string;
  enabled?: boolean;
}): void {
  publishControlCenterEvent({
    type: 'modules:changed',
    dealershipId: input.dealershipId,
    modules: {
      moduleId: input.moduleId,
      enabled: input.enabled,
    },
  });
}
