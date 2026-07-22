/**
 * In-isolate pub/sub for AI job progress (SSE + same-worker handlers).
 * Multi-isolate: SSE also polls D1 so other isolates still converge.
 */

export type AiJobLuxuryPhase =
  | 'queued'
  | 'processing'
  | 'ai_thinking'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface AiJobEvent {
  type: 'job.update' | 'job.connected' | 'job.heartbeat';
  jobId: string;
  status?: string;
  phase?: AiJobLuxuryPhase;
  progress?: number;
  errorMessage?: string | null;
  kind?: string;
  /** Present on terminal success when available (same-isolate SSE). */
  result?: unknown;
  timestamp: string;
}

type Listener = (event: AiJobEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Map progress % → luxury phase for bay UI. */
export function luxuryPhaseFromProgress(
  status: string,
  progress: number
): AiJobLuxuryPhase {
  if (status === 'succeeded') return 'complete';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'queued' || progress < 15) return 'queued';
  if (progress < 45) return 'processing';
  if (progress < 100) return 'ai_thinking';
  return 'processing';
}

export function publishJobEvent(event: Omit<AiJobEvent, 'timestamp'> & { timestamp?: string }): void {
  const full: AiJobEvent = {
    ...event,
    timestamp: event.timestamp ?? new Date().toISOString(),
  };
  const set = listeners.get(event.jobId);
  if (!set || set.size === 0) return;
  for (const listener of set) {
    try {
      listener(full);
    } catch {
      // never break producers
    }
  }
}

export function subscribeJobEvents(jobId: string, listener: Listener): () => void {
  let set = listeners.get(jobId);
  if (!set) {
    set = new Set();
    listeners.set(jobId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(jobId);
  };
}

export function jobEventListenerCount(jobId: string): number {
  return listeners.get(jobId)?.size ?? 0;
}
