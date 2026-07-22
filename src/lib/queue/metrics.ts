/**
 * Lightweight in-process metrics for AI queue (logged + health).
 */
import { logger } from '@/lib/logger';

export interface QueueMetricsSnapshot {
  enqueued: number;
  completed: number;
  failed: number;
  retried: number;
  inlineFallback: number;
  byPriority: Record<string, number>;
  byJobType: Record<string, number>;
  lastErrorAt: string | null;
  lastEnqueueAt: string | null;
  lastCompleteAt: string | null;
}

const metrics: QueueMetricsSnapshot = {
  enqueued: 0,
  completed: 0,
  failed: 0,
  retried: 0,
  inlineFallback: 0,
  byPriority: {},
  byJobType: {},
  lastErrorAt: null,
  lastEnqueueAt: null,
  lastCompleteAt: null,
};

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

export function recordQueueEnqueue(jobType: string, priority: string, transport: 'queue' | 'inline'): void {
  metrics.enqueued += 1;
  metrics.lastEnqueueAt = new Date().toISOString();
  bump(metrics.byJobType, jobType);
  bump(metrics.byPriority, priority);
  if (transport === 'inline') metrics.inlineFallback += 1;
  logger.info('ai_queue.metric.enqueue', { jobType, priority, transport, total: metrics.enqueued });
}

export function recordQueueComplete(jobType: string): void {
  metrics.completed += 1;
  metrics.lastCompleteAt = new Date().toISOString();
  logger.info('ai_queue.metric.complete', { jobType, total: metrics.completed });
}

export function recordQueueFail(jobType: string, retryable: boolean): void {
  if (retryable) {
    metrics.retried += 1;
    logger.info('ai_queue.metric.retry', { jobType, total: metrics.retried });
  } else {
    metrics.failed += 1;
    metrics.lastErrorAt = new Date().toISOString();
    logger.warn('ai_queue.metric.fail', { jobType, total: metrics.failed });
  }
}

export function getQueueMetricsSnapshot(): QueueMetricsSnapshot {
  return {
    ...metrics,
    byPriority: { ...metrics.byPriority },
    byJobType: { ...metrics.byJobType },
  };
}

/** Approximate error rate 0–1 over completed+failed (in-isolate only). */
export function getQueueErrorRate(): number {
  const denom = metrics.completed + metrics.failed;
  if (denom === 0) return 0;
  return metrics.failed / denom;
}
