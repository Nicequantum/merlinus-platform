import { Prisma } from '@prisma/client';
import { logger } from './logger';

/** Health probe / startup warmup only — not used on login or RO scan request paths. */
export const DB_HEALTH_RETRY_ATTEMPTS = 4;
export const DB_HEALTH_RETRY_BASE_MS = 50;
export const DB_HEALTH_RETRY_MAX_MS = 400;

const RETRYABLE_PRISMA_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
]);

const RETRYABLE_NODE_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE']);

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
}

/**
 * Retries transient DB connection failures with exponential backoff.
 * Use only for health probes and background cold-start warmup — never wrap
 * per-request login, RO scan, or story workflow queries (fail fast there).
 */
export async function withDbConnectionRetry<T>(
  fn: () => Promise<T>,
  options: DbConnectionRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DB_HEALTH_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DB_HEALTH_RETRY_BASE_MS;
  const maxDelayMs = options.maxDelayMs ?? DB_HEALTH_RETRY_MAX_MS;
  const context = options.context ?? 'db.probe';

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= maxAttempts - 1;
      if (!isRetryableDbConnectionError(error) || isLastAttempt) {
        throw error;
      }

      const delayMs = computeDbRetryDelayMs(attempt, baseDelayMs, maxDelayMs);
      logger.warn('db.connection_retry', {
        context,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : 'unknown',
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}