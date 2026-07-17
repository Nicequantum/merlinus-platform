/**
 * Phase 7.2 (H10) — per-request correlation id for logs, Sentry, and response headers.
 *
 * Edge/middleware-safe: no `node:crypto` or `node:async_hooks` imports (those break
 * the client/Edge webpack graph when pulled via logger → bootstrapGuard → middleware).
 */

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestContextStore {
  requestId: string;
  routeKey?: string;
}

type AlsLike = {
  getStore: () => RequestContextStore | undefined;
  run: <T>(store: RequestContextStore, fn: () => T) => T;
};

/** Stack-based store when AsyncLocalStorage is unavailable (Edge/client). */
function createStackStore(): AlsLike {
  const stack: RequestContextStore[] = [];
  return {
    getStore: () => stack[stack.length - 1],
    run: <T>(store: RequestContextStore, fn: () => T) => {
      stack.push(store);
      try {
        return fn();
      } finally {
        stack.pop();
      }
    },
  };
}

/**
 * Prefer Node AsyncLocalStorage when present (API routes on Node runtime).
 * Detect without a static `node:` import so Edge/client bundles never resolve it.
 */
function createRequestStore(): AlsLike {
  try {
    // Global present on Node 16+ without importing node:async_hooks into the graph.
    const g = globalThis as typeof globalThis & {
      AsyncLocalStorage?: new <T>() => {
        getStore(): T | undefined;
        run<R>(store: T, fn: () => R): R;
      };
    };
    if (typeof g.AsyncLocalStorage === 'function') {
      return new g.AsyncLocalStorage<RequestContextStore>();
    }
  } catch {
    // fall through
  }
  return createStackStore();
}

/** Lazy so instrumentation can polyfill globalThis.AsyncLocalStorage before first use. */
let storage: AlsLike | null = null;

function als(): AlsLike {
  if (!storage) storage = createRequestStore();
  return storage;
}

/** Web Crypto first (Edge + modern Node); never import node:crypto. */
function newRequestId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function createRequestId(incoming?: string | null): string {
  const trimmed = incoming?.trim();
  if (trimmed && /^[a-zA-Z0-9_-]{8,64}$/.test(trimmed)) {
    return trimmed;
  }
  return newRequestId();
}

export function getRequestId(): string | undefined {
  return als().getStore()?.requestId;
}

export function getRequestContext(): RequestContextStore | undefined {
  return als().getStore();
}

export function runWithRequestContext<T>(
  ctx: RequestContextStore,
  fn: () => Promise<T> | T
): Promise<T> | T {
  return als().run(ctx, fn);
}

/** Prefer inbound X-Request-Id when present (gateway / client correlation). */
export function resolveRequestIdFromRequest(request: Request): string {
  return createRequestId(request.headers.get(REQUEST_ID_HEADER));
}

export function applyRequestIdHeader(response: Response, requestId: string): void {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  } catch {
    // immutable response — ignore
  }
}
