import { Prisma } from '@prisma/client';
import { logger } from './logger';

/** Health probe / startup warmup only — not used on login or RO scan request paths. */
export const DB_HEALTH_RETRY_ATTEMPTS = 4;
export const DB_HEALTH_RETRY_BASE_MS = 50;
export const DB_HEALTH_RETRY_MAX_MS = 400;

/** Request-path create/write: true SQLITE_BUSY / D1 blips only (invalid query = fail fast). */
export const DB_REQUEST_RETRY_ATTEMPTS = 5;
export const DB_REQUEST_RETRY_BASE_MS = 200;
export const DB_REQUEST_RETRY_MAX_MS = 2500;

const RETRYABLE_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  // Interactive transaction / write conflict on some engines
  'P2034',
]);

const RETRYABLE_NODE_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE']);

/** Structured fields for logs (never throw). */
export function describeDbError(error: unknown): {
  name: string;
  message: string;
  code?: string;
  meta?: unknown;
} {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      meta: error.meta,
    };
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      name: error.name,
      message: error.message,
      code: error.errorCode,
    };
  }
  if (error instanceof Error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : undefined;
    return {
      name: error.name || 'Error',
      message: error.message,
      code: code || undefined,
    };
  }
  return { name: 'unknown', message: String(error) };
}

export function isRetryableDbConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return RETRYABLE_PRISMA_CODES.has(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code && RETRYABLE_NODE_CODES.has(code)) return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("can't reach database server")) return true;
    if (message.includes('connection pool') && message.includes('timeout')) return true;
    if (message.includes('timed out') && message.includes('database')) return true;
  }
  return false;
}

/**
 * Transient D1 / SQLite / workerd failures safe to retry on the request path
 * (RO create, etc.) — broader than pure connection errors.
 */
export function isRetryableDbTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message;
    // Deterministic Prisma/D1 invalid query — never retry.
    if (/Invalid\s+`?prisma\./i.test(message) || /invalid.*prisma\.\w+\./i.test(message)) {
      return false;
    }
  }
  if (isRetryableDbConnectionError(error)) return true;
  if (error instanceof Error) {
    const message = error.message;
    if (
      /D1_ERROR|NETWORK_ERROR|storage exception|overloaded|SQLITE_BUSY|SQLITE_LOCKED|database is locked|connection reset|ECONNRESET|too many requests/i.test(
        message
      )
    ) {
      return true;
    }
  }
  return false;
}

export function computeDbRetryDelayMs(
  attempt: number,
  baseMs: number = DB_HEALTH_RETRY_BASE_MS,
  maxMs: number = DB_HEALTH_RETRY_MAX_MS
): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DbConnectionRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  context?: string;
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Retries transient DB failures with exponential backoff.
 * Default: health probes. For RO create use withRequestDbRetry.
 */
export async function withDbConnectionRetry<T>(
  fn: () => Promise<T>,
  options: DbConnectionRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DB_HEALTH_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DB_HEALTH_RETRY_BASE_MS;
  const maxDelayMs = options.maxDelayMs ?? DB_HEALTH_RETRY_MAX_MS;
  const context = options.context ?? 'db.probe';
  const isRetryable = options.isRetryable ?? isRetryableDbConnectionError;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (!isRetryable(error) || isLastAttempt) {
        throw error;
      }

      const delayMs = computeDbRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
      const described = describeDbError(error);
      logger.warn('db.connection_retry', {
        context,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        errorName: described.name,
        errorCode: described.code,
        error: described.message,
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

/** Request-path RO create / similar writes — D1 cold + SQLITE_BUSY. */
export async function withRequestDbRetry<T>(
  fn: () => Promise<T>,
  options: { context?: string; maxAttempts?: number } = {}
): Promise<T> {
  return withDbConnectionRetry(fn, {
    context: options.context ?? 'db.request',
    maxAttempts: options.maxAttempts ?? DB_REQUEST_RETRY_ATTEMPTS,
    baseDelayMs: DB_REQUEST_RETRY_BASE_MS,
    maxDelayMs: DB_REQUEST_RETRY_MAX_MS,
    isRetryable: isRetryableDbTransientError,
  });
}
