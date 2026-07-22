/**
 * Lightweight client fetch with exponential backoff — used by national owner shell
 * and login helpers without pulling the full @/lib/api surface into the login bundle.
 *
 * Retries:
 * - Network / transport failures
 * - 408, 429, 502, 503, 504
 * - 500 on GET/HEAD (Workers cold-start + first D1 query)
 * - 500 on POST when `retryPostServerError: true` (enter/exit dealership, etc.)
 */
import { readJsonBodySafe } from '@/lib/apiResponseParse';
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/csrf';
import {
  isNetworkFailure,
  isRetriableHttpStatus,
  networkRetryDelayMs,
  NETWORK_RETRY_MAX_ATTEMPTS,
  parseRetryAfterMs,
  shouldRetryServerErrorForMethod,
  sleep,
} from '@/lib/networkErrors';
import { isRequestAborted } from '@/lib/requestAbort';

export type ClientFetchRetryOptions = RequestInit & {
  timeoutMs?: number;
  maxRetries?: number;
  /** Retry bare 500 on POST/PUT (default false). Safe for enter-dealership / exit. */
  retryPostServerError?: boolean;
  /** Optional external abort (caller cancellation). */
  externalSignal?: AbortSignal;
};

function methodOf(init?: RequestInit): string {
  return (init?.method || 'GET').toUpperCase();
}

function shouldRetryStatus(
  status: number,
  method: string,
  retryPostServerError: boolean
): boolean {
  const includeServerError =
    shouldRetryServerErrorForMethod(method) ||
    (retryPostServerError && (method === 'POST' || method === 'PUT'));
  return isRetriableHttpStatus(status, { includeServerError });
}

/**
 * fetch() with network + transient HTTP retries. Returns the final Response
 * (caller checks res.ok). Throws on transport failure after exhausting retries.
 */
export async function fetchWithClientRetry(
  path: string,
  options: ClientFetchRetryOptions = {}
): Promise<Response> {
  const {
    timeoutMs,
    maxRetries = NETWORK_RETRY_MAX_ATTEMPTS,
    retryPostServerError = false,
    externalSignal,
    ...init
  } = options;

  const method = methodOf(init);
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (externalSignal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);
    const timer =
      timeoutMs && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      const csrf = readCsrfTokenFromDocument();
      const headers = new Headers(init.headers || undefined);
      if (csrf && !headers.has(CSRF_HEADER)) {
        headers.set(CSRF_HEADER, csrf);
      }
      const res = await fetch(path, {
        ...init,
        headers,
        credentials: init.credentials ?? 'include',
        cache: init.cache ?? 'no-store',
        signal: controller.signal,
      });

      if (!res.ok && shouldRetryStatus(res.status, method, retryPostServerError) && attempt < maxRetries) {
        const retryAfterMs =
          res.status === 429 ? parseRetryAfterMs(res.headers.get('Retry-After')) : undefined;
        await sleep(retryAfterMs ?? networkRetryDelayMs(attempt));
        continue;
      }

      return res;
    } catch (error) {
      if (isRequestAborted(error)) {
        if (externalSignal?.aborted) throw error;
        throw new Error(
          timeoutMs
            ? `Request timed out after ${Math.round(timeoutMs / 1000)}s`
            : 'Request was aborted'
        );
      }

      lastError = error;
      if (!isNetworkFailure(error) || attempt === maxRetries) {
        throw error;
      }
      await sleep(networkRetryDelayMs(attempt));
    } finally {
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
}

export async function fetchJsonWithClientRetry<T>(
  path: string,
  options: ClientFetchRetryOptions = {}
): Promise<T> {
  const res = await fetchWithClientRetry(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });

  const parsed = await readJsonBodySafe<T>(res);
  if (!parsed.ok) {
    // parseApiErrorResponse already used inside readJsonBodySafe for !res.ok
    throw new Error(parsed.error.message || `Request failed (${res.status})`);
  }
  return parsed.data;
}

/** Fire-and-forget isolate/D1 warm — never throws to callers. */
export async function warmOwnerIsolate(): Promise<boolean> {
  try {
    const res = await fetchWithClientRetry('/api/owner/warmup', {
      method: 'GET',
      timeoutMs: 12_000,
      maxRetries: 2,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * P1-2 — Warm auth + D1 path for any signed-in user (technician, manager, owner).
 * Prefer this after login and on bay session keep-alive.
 */
export async function warmSessionIsolate(): Promise<boolean> {
  try {
    const res = await fetchWithClientRetry('/api/session/warmup', {
      method: 'GET',
      timeoutMs: 12_000,
      maxRetries: 2,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Public status ping — keeps the Worker isolate warm without auth. */
export async function keepAlivePublicStatus(): Promise<boolean> {
  try {
    const res = await fetchWithClientRetry('/api/status', {
      method: 'GET',
      credentials: 'omit',
      timeoutMs: 8_000,
      maxRetries: 1,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Soft interval keep-alive while the authenticated shell is mounted.
 * Alternates session warmup with public status so cold starts stay rare.
 * Pauses when the tab is hidden (battery) and warms immediately on resume.
 */
export function startBaySessionKeepAlive(options?: {
  intervalMs?: number;
  /** When set, also seeds RO list cache on visibility resume */
  technicianId?: string;
  dealershipId?: string;
  /** Default true — run aggressive warm (session + status + optional RO prefetch) on start */
  aggressive?: boolean;
}): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const intervalMs = options?.intervalMs ?? 75_000;
  let ticks = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    ticks += 1;
    if (ticks % 3 === 0 && options?.technicianId && options?.dealershipId) {
      void import('@/lib/bayWarmup')
        .then(({ prefetchTodayRoList }) =>
          prefetchTodayRoList({
            technicianId: options.technicianId,
            dealershipId: options.dealershipId,
          })
        )
        .catch(() => undefined);
    } else if (ticks % 2 === 1) {
      void warmSessionIsolate();
    } else {
      void keepAlivePublicStatus();
    }
  };

  // Immediate warm after login / shell mount
  if (options?.aggressive !== false) {
    void import('@/lib/bayWarmup')
      .then(({ runAggressiveBayWarmup }) =>
        runAggressiveBayWarmup({
          prefetchRoList: Boolean(options?.technicianId && options?.dealershipId),
          technicianId: options?.technicianId,
          dealershipId: options?.dealershipId,
        })
      )
      .catch(() => {
        void warmSessionIsolate();
      });
  } else {
    void warmSessionIsolate();
  }

  const id = window.setInterval(tick, intervalMs);

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      ticks = 0;
      void warmSessionIsolate();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    window.clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
