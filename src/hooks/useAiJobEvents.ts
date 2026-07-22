'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiJobLuxuryPhase } from '@/lib/queue/jobEventsHub';

export type { AiJobLuxuryPhase };

export interface AiJobLiveState {
  jobId: string;
  phase: AiJobLuxuryPhase;
  progress: number;
  status: string;
  errorMessage: string | null;
  kind?: string;
  result?: unknown;
  connected: boolean;
}

const PHASE_LABELS: Record<AiJobLuxuryPhase, string> = {
  queued: 'Queued',
  processing: 'Processing',
  ai_thinking: 'AI thinking',
  complete: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function luxuryPhaseLabel(phase: AiJobLuxuryPhase): string {
  return PHASE_LABELS[phase] || phase;
}

/**
 * Subscribe to real-time AI job updates via SSE (falls back to nothing if EventSource fails —
 * callers should still use pollAiJobUntilDone which prefers SSE then poll).
 */
export function useAiJobEvents(jobId: string | null): AiJobLiveState | null {
  const [state, setState] = useState<AiJobLiveState | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  useEffect(() => {
    if (!jobId) {
      setState(null);
      disconnect();
      return;
    }

    setState({
      jobId,
      phase: 'queued',
      progress: 0,
      status: 'queued',
      errorMessage: null,
      connected: false,
    });

    // EventSource cannot set custom headers; cookie session is sent same-origin.
    const url = `/api/queue/job-events/${encodeURIComponent(jobId)}`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      setState((prev) => (prev ? { ...prev, connected: true } : prev));
    };

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type?: string;
          jobId?: string;
          phase?: AiJobLuxuryPhase;
          progress?: number;
          status?: string;
          errorMessage?: string | null;
          kind?: string;
          result?: unknown;
        };
        if (data.type === 'job.heartbeat') return;
        setState((prev) => ({
          jobId: data.jobId || jobId,
          phase: data.phase || prev?.phase || 'queued',
          progress: typeof data.progress === 'number' ? data.progress : prev?.progress ?? 0,
          status: data.status || prev?.status || 'queued',
          errorMessage: data.errorMessage ?? prev?.errorMessage ?? null,
          kind: data.kind || prev?.kind,
          result: data.result !== undefined ? data.result : prev?.result,
          connected: true,
        }));
      } catch {
        // ignore malformed
      }
    };

    es.onerror = () => {
      setState((prev) => (prev ? { ...prev, connected: false } : prev));
    };

    return () => {
      disconnect();
    };
  }, [jobId, disconnect]);

  return state;
}
