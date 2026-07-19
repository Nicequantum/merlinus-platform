/** True when fetch failed before an HTTP response (offline, DNS, CORS transport, etc.). */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('failed to fetch') || message.includes('networkerror when attempting to fetch resource')) {
      return true;
    }
    if (error.name === 'NetworkError') return true;
  }
  return false;
}

export const NETWORK_RETRY_MAX_ATTEMPTS = 3;
export const NETWORK_RETRY_BASE_MS = 300;
/** Jitter fraction so concurrent cold-start retries do not stampede the isolate. */
export const NETWORK_RETRY_JITTER = 0.25;

export type RetriableHttpStatusOptions = {
  /**
   * Retry bare 500 responses (Cloudflare Workers / D1 cold-start often surfaces as 500
   * on the first Prisma hit). Safe for idempotent GETs and carefully chosen POSTs
   * (enter-dealership, session probes). Do not enable for non-idempotent money/AI writes.
   */
  includeServerError?: boolean;
};

/** HTTP statuses worth retrying for uploads and other idempotent reads/writes. */
export function isRetriableHttpStatus(
  status: number,
  options?: RetriableHttpStatusOptions
): boolean {
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  if (options?.includeServerError && status === 500) {
    return true;
  }
  return false;
}

/**
 * True when this request method is safe to auto-retry on transient 500s.
 * GET/HEAD always; POST only when the caller opts in via includeServerError on a
 * known-idempotent route (owner enter, session probe).
 */
export function shouldRetryServerErrorForMethod(method: string | undefined): boolean {
  const m = (method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

export function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header?.trim()) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Exponential backoff with light jitter (attempt 0 → ~300ms, 1 → ~600ms, 2 → ~1200ms).
 * Pass `{ jitter: false }` for deterministic unit tests.
 */
export function networkRetryDelayMs(attempt: number, options?: { jitter?: boolean }): number {
  const base = NETWORK_RETRY_BASE_MS * 2 ** Math.max(0, attempt);
  if (options?.jitter === false) return base;
  const jitter = base * NETWORK_RETRY_JITTER * Math.random();
  return Math.round(base + jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}