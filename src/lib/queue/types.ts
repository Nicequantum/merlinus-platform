/**
 * Durable Async AI — queue message schemas (Zod).
 */
import { z } from 'zod';

export const AI_QUEUE_JOB_TYPES = [
  'story.generate',
  'vision.extract',
  'vision.diagnostic',
  'mpi.report',
  'hub.summarize',
] as const;

export type AiQueueJobType = (typeof AI_QUEUE_JOB_TYPES)[number];

export const aiQueueJobTypeSchema = z.enum(AI_QUEUE_JOB_TYPES);

export const aiQueuePrioritySchema = z.enum(['low', 'normal', 'high']).default('normal');

/** Envelope sent on AI_JOBS_QUEUE and accepted by /api/queue/ai-consumer */
export const aiQueueMessageSchema = z.object({
  /** D1 AiJob.id — durable status row */
  jobId: z.string().trim().min(1).max(64),
  jobType: aiQueueJobTypeSchema,
  dealershipId: z.string().trim().min(1).max(64),
  /** Authenticated technician / user who requested the work */
  userId: z.string().trim().min(1).max(64),
  roId: z.string().trim().min(1).max(64).optional(),
  lineId: z.string().trim().min(1).max(64).optional(),
  priority: aiQueuePrioritySchema,
  /** Attempt count (1-based); consumer increments on retry */
  attempt: z.number().int().min(1).max(10).default(1),
  /** Opaque job-specific payload (notes, inspectionId, etc.) */
  payload: z.record(z.unknown()).default({}),
  enqueuedAt: z.string().datetime().optional(),
});

export type AiQueueMessage = z.infer<typeof aiQueueMessageSchema>;

export const AI_QUEUE_MAX_ATTEMPTS = 3;

/** Exponential backoff base (ms) for client poll + documented server retry guidance */
export function queueRetryDelayMs(attempt: number): number {
  const base = 1_000;
  return Math.min(60_000, base * 2 ** Math.max(0, attempt - 1));
}
