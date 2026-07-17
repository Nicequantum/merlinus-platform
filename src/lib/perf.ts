import { logger } from './logger';

/** Structured performance metric — consistent `perf.*` event namespace for log aggregation. */
export function logPerformance(
  event: string,
  durationMs: number,
  context?: Record<string, unknown>
): void {
  logger.info(`perf.${event}`, {
    durationMs: Math.round(durationMs),
    ...context,
  });
}

export async function withPerformance<T>(
  event: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    logPerformance(event, Date.now() - start, context);
  }
}