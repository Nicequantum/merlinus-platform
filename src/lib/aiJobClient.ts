/**
 * Client helpers for durable AI jobs — SSE-first with poll fallback (offline-friendly).
 */
import { api } from '@/lib/api';
import type { AiJobLuxuryPhase } from '@/lib/queue/jobEventsHub';

export type AiJobPhase = AiJobLuxuryPhase;

export interface PollAiJobOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onPhase?: (phase: AiJobPhase, progress: number, label: string) => void;
  signal?: AbortSignal;
  /** Prefer SSE when available (default true) */
  preferSse?: boolean;
}

const PHASE_TOAST: Record<string, string> = {
  queued: 'Story queued for the AI bay…',
  processing: 'Preparing evidence & context…',
  ai_thinking: 'AI is writing your warranty story…',
  complete: 'Story ready',
  failed: 'Story generation failed',
  cancelled: 'Job cancelled',
};

export function technicianFriendlyJobError(message: string | null | undefined): string {
  const m = (message || '').toLowerCase();
  if (!m) return 'Something went wrong generating the story. You can retry or ask a manager.';
  if (m.includes('customer pay')) {
    return 'This line is in Customer Pay mode. Clear Customer Pay, then generate again.';
  }
  if (m.includes('timeout') || m.includes('timed out')) {
    return 'The AI took too long (shop Wi‑Fi may be slow). Retry when the connection is solid.';
  }
  if (m.includes('grok') || m.includes('xai') || m.includes('unavailable')) {
    return 'AI service is temporarily unavailable. Retry in a minute or contact your manager.';
  }
  if (m.includes('not found')) {
    return 'That repair order line is no longer available. Refresh the RO and try again.';
  }
  if (m.includes('cancelled')) {
    return 'This job was cancelled by a manager.';
  }
  // Avoid raw stack / internal text
  if (message && message.length < 160 && !m.includes('prisma') && !m.includes('sql')) {
    return message;
  }
  return 'Story generation failed. Retry, or contact your manager if it keeps happening.';
}

export function phaseLabel(phase: string): string {
  return PHASE_TOAST[phase] || phase;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/**
 * Wait for job completion via EventSource SSE, falling back to HTTP poll.
 */
export async function pollAiJobUntilDone(
  jobId: string,
  options?: PollAiJobOptions
): Promise<{
  phase: AiJobPhase;
  progress: number;
  result: unknown;
  errorMessage: string | null;
}> {
  const preferSse = options?.preferSse !== false;
  if (preferSse && typeof EventSource !== 'undefined') {
    try {
      return await waitViaSse(jobId, options);
    } catch {
      // fall through to poll (offline SSE / proxy issues)
    }
  }
  return waitViaPoll(jobId, options);
}

function waitViaSse(
  jobId: string,
  options?: PollAiJobOptions
): Promise<{
  phase: AiJobPhase;
  progress: number;
  result: unknown;
  errorMessage: string | null;
}> {
  const timeoutMs = options?.timeoutMs ?? 130_000;
  return new Promise((resolve, reject) => {
    const url = `/api/queue/job-events/${encodeURIComponent(jobId)}`;
    const es = new EventSource(url, { withCredentials: true });
    let settled = false;
    let lastPhase: AiJobPhase = 'queued';
    let lastProgress = 0;
    let lastResult: unknown = null;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Story job timed out (last phase: ${lastPhase}). Tap generate again to retry.`));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    options?.signal?.addEventListener('abort', onAbort);

    function cleanup() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', onAbort);
      es.close();
    }

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as {
          type?: string;
          phase?: AiJobPhase;
          progress?: number;
          status?: string;
          errorMessage?: string | null;
          result?: unknown;
        };
        if (data.type === 'job.heartbeat') return;

        const phase =
          data.phase ||
          (data.status === 'succeeded'
            ? 'complete'
            : data.status === 'failed'
              ? 'failed'
              : data.status === 'cancelled'
                ? 'cancelled'
                : lastPhase);
        const progress = typeof data.progress === 'number' ? data.progress : lastProgress;
        lastPhase = phase as AiJobPhase;
        lastProgress = progress;
        if (data.result !== undefined) lastResult = data.result;
        options?.onPhase?.(lastPhase, progress, phaseLabel(lastPhase));

        if (phase === 'complete' || data.status === 'succeeded') {
          cleanup();
          resolve({
            phase: 'complete',
            progress: 100,
            result: data.result ?? lastResult,
            errorMessage: null,
          });
        } else if (phase === 'failed' || data.status === 'failed') {
          cleanup();
          resolve({
            phase: 'failed',
            progress,
            result: data.result ?? null,
            errorMessage: data.errorMessage || 'Job failed',
          });
        } else if (phase === 'cancelled' || data.status === 'cancelled') {
          cleanup();
          resolve({
            phase: 'cancelled',
            progress,
            result: null,
            errorMessage: data.errorMessage || 'Cancelled',
          });
        }
      } catch {
        // ignore
      }
    };

    es.onerror = () => {
      // Let timeout or outer fallback handle; don't reject immediately (reconnects)
    };
  });
}

async function waitViaPoll(
  jobId: string,
  options?: PollAiJobOptions
): Promise<{
  phase: AiJobPhase;
  progress: number;
  result: unknown;
  errorMessage: string | null;
}> {
  const timeoutMs = options?.timeoutMs ?? 130_000;
  const started = Date.now();
  let interval = options?.intervalMs ?? 800;
  let lastPhase: AiJobPhase = 'queued';

  while (Date.now() - started < timeoutMs) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const status = await api.getAiJobStatus(jobId);
    const phase = (status.phase || status.status) as AiJobPhase;
    lastPhase = phase === 'processing' && status.progress >= 45 ? 'ai_thinking' : phase;
    options?.onPhase?.(lastPhase, status.progress, phaseLabel(lastPhase));

    if (status.phase === 'complete' || status.status === 'succeeded') {
      return {
        phase: 'complete',
        progress: status.progress,
        result: status.result,
        errorMessage: null,
      };
    }
    if (status.phase === 'failed' || status.status === 'failed') {
      return {
        phase: 'failed',
        progress: status.progress,
        result: status.result,
        errorMessage: status.errorMessage,
      };
    }
    if (status.status === 'cancelled') {
      return {
        phase: 'cancelled',
        progress: status.progress,
        result: null,
        errorMessage: status.errorMessage,
      };
    }

    await sleep(interval, options?.signal);
    interval = Math.min(4_000, Math.round(interval * 1.35));
  }

  throw new Error(
    `Story job timed out (last phase: ${lastPhase}). Tap generate again to retry.`
  );
}
