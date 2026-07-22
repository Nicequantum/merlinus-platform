/**
 * Durable Async AI — queue producers + job orchestration.
 *
 * Flow:
 *  1. createAiJob (D1) status=queued
 *  2. enqueue to AI_JOBS_QUEUE when binding present
 *  3. Else process via scheduleBackgroundWork (dev / no queue)
 *  4. Consumer → processAiQueueMessage → handlers → mark succeeded/failed
 */
import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { createAiJob, markAiJobFailed, markAiJobRunning } from '@/lib/aiJobs/service';
import { scheduleBackgroundWork } from '@/lib/aiJobs/schedule';
import { logger } from '@/lib/logger';
import { getAiJobsQueue, isAiJobsQueueConfigured } from '@/lib/queue/binding';
import { recordQueueEnqueue } from '@/lib/queue/metrics';
import {
  AI_QUEUE_MAX_ATTEMPTS,
  aiQueueMessageSchema,
  type AiQueueJobType,
  type AiQueueMessage,
} from '@/lib/queue/types';
import { processAiQueueMessage } from '@/lib/queue/processMessage';

export { isAiJobsQueueConfigured } from '@/lib/queue/binding';
export type { AiQueueMessage, AiQueueJobType } from '@/lib/queue/types';

export interface EnqueueAiJobInput {
  jobType: AiQueueJobType;
  dealershipId: string;
  userId: string;
  roId?: string;
  lineId?: string;
  entityType?: string | null;
  entityId?: string | null;
  priority?: 'low' | 'normal' | 'high';
  payload?: Record<string, unknown>;
  /**
   * When true (default), if queue missing, process via waitUntil/background.
   * When false, only enqueue (fail if no queue).
   */
  allowInlineFallback?: boolean;
}

export interface EnqueueAiJobResult {
  jobId: string;
  transport: 'queue' | 'inline';
  status: 'queued' | 'running';
}

/**
 * Create durable AiJob row and deliver work to CF Queue or inline fallback.
 */
export async function enqueueDurableAiJob(
  input: EnqueueAiJobInput
): Promise<EnqueueAiJobResult> {
  const allowInline = input.allowInlineFallback !== false;
  const kind = input.jobType;
  const entityType =
    input.entityType ??
    (input.lineId ? 'repairLine' : input.roId ? 'repairOrder' : null);
  const entityId = input.entityId ?? input.lineId ?? input.roId ?? null;

  const priority = input.priority ?? (input.jobType === 'story.generate' ? 'high' : 'normal');

  const { id: jobId } = await createAiJob({
    dealershipId: input.dealershipId,
    technicianId: input.userId,
    kind,
    entityType,
    entityId,
    priority,
  });

  const message: AiQueueMessage = aiQueueMessageSchema.parse({
    jobId,
    jobType: input.jobType,
    dealershipId: input.dealershipId,
    userId: input.userId,
    roId: input.roId,
    lineId: input.lineId,
    priority,
    attempt: 1,
    payload: input.payload ?? {},
    enqueuedAt: new Date().toISOString(),
  });

  // Priority → CF Queue delaySeconds (lower delay = higher effective priority)
  const delaySeconds =
    priority === 'high' ? 0 : priority === 'normal' ? 1 : 5;

  const queue = getAiJobsQueue();
  if (queue) {
    try {
      await queue.send(message, { delaySeconds });
      recordQueueEnqueue(input.jobType, priority, 'queue');
      logger.info('ai_queue.enqueued', {
        jobId,
        jobType: input.jobType,
        dealershipId: input.dealershipId,
        priority: message.priority,
        delaySeconds,
      });
      Sentry.addBreadcrumb({
        category: 'ai_queue',
        message: 'job_enqueued',
        data: { jobId, jobType: input.jobType, priority },
      });
      return { jobId, transport: 'queue', status: 'queued' };
    } catch (error) {
      logger.error('ai_queue.send_failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
        tags: { ai_queue: 'send_failed', jobType: input.jobType },
        extra: { jobId },
      });
      if (!allowInline) {
        await markAiJobFailed(jobId, 'Failed to enqueue AI job');
        throw error;
      }
      // fall through to inline
    }
  }

  if (!allowInline) {
    await markAiJobFailed(jobId, 'AI queue not configured');
    throw new Error('AI_JOBS_QUEUE is not configured');
  }

  // Dev / missing binding: process in-background (same handlers as consumer)
  logger.info('ai_queue.inline_fallback', {
    jobId,
    jobType: input.jobType,
    reason: queue ? 'send_failed' : 'no_binding',
  });
  recordQueueEnqueue(input.jobType, priority, 'inline');
  await scheduleBackgroundWork(`ai_queue.inline:${jobId}`, async () => {
    await processAiQueueMessage(message, { source: 'inline' });
  });

  return { jobId, transport: 'inline', status: 'queued' };
}

/**
 * Batch-enqueue multiple jobs (uses Queue sendBatch when available).
 */
export async function enqueueDurableAiJobBatch(
  inputs: EnqueueAiJobInput[]
): Promise<EnqueueAiJobResult[]> {
  if (inputs.length === 0) return [];
  if (inputs.length === 1) {
    return [await enqueueDurableAiJob(inputs[0]!)];
  }

  const queue = getAiJobsQueue();
  if (!queue?.sendBatch) {
    const out: EnqueueAiJobResult[] = [];
    for (const input of inputs) {
      out.push(await enqueueDurableAiJob(input));
    }
    return out;
  }

  const prepared: { result: EnqueueAiJobResult; message: AiQueueMessage; delaySeconds: number }[] =
    [];

  for (const input of inputs) {
    const priority =
      input.priority ?? (input.jobType === 'story.generate' ? 'high' : 'normal');
    const entityType =
      input.entityType ??
      (input.lineId ? 'repairLine' : input.roId ? 'repairOrder' : null);
    const entityId = input.entityId ?? input.lineId ?? input.roId ?? null;
    const { id: jobId } = await createAiJob({
      dealershipId: input.dealershipId,
      technicianId: input.userId,
      kind: input.jobType,
      entityType,
      entityId,
      priority,
    });
    const message = aiQueueMessageSchema.parse({
      jobId,
      jobType: input.jobType,
      dealershipId: input.dealershipId,
      userId: input.userId,
      roId: input.roId,
      lineId: input.lineId,
      priority,
      attempt: 1,
      payload: input.payload ?? {},
      enqueuedAt: new Date().toISOString(),
    });
    const delaySeconds = priority === 'high' ? 0 : priority === 'normal' ? 1 : 5;
    prepared.push({
      result: { jobId, transport: 'queue', status: 'queued' },
      message,
      delaySeconds,
    });
  }

  try {
    await queue.sendBatch(
      prepared.map((p) => ({
        body: p.message,
        options: { delaySeconds: p.delaySeconds },
      }))
    );
    for (const p of prepared) {
      recordQueueEnqueue(p.message.jobType, p.message.priority, 'queue');
    }
    return prepared.map((p) => p.result);
  } catch (error) {
    logger.error('ai_queue.send_batch_failed', {
      error: error instanceof Error ? error.message : String(error),
      count: prepared.length,
    });
    // Fall back to per-job inline
    const out: EnqueueAiJobResult[] = [];
    for (const p of prepared) {
      recordQueueEnqueue(p.message.jobType, p.message.priority, 'inline');
      await scheduleBackgroundWork(`ai_queue.inline:${p.message.jobId}`, async () => {
        await processAiQueueMessage(p.message, { source: 'inline' });
      });
      out.push({ ...p.result, transport: 'inline' });
    }
    return out;
  }
}

/**
 * Story generation producer — preferred entry for warranty narrative jobs.
 */
export async function enqueueStoryGenerationJob(input: {
  dealershipId: string;
  userId: string;
  roId: string;
  lineId: string;
  technicianNotes?: string;
  warrantyStory?: string;
  preferredLanguage?: string;
  priority?: 'low' | 'normal' | 'high';
  allowInlineFallback?: boolean;
}): Promise<EnqueueAiJobResult> {
  return enqueueDurableAiJob({
    jobType: 'story.generate',
    dealershipId: input.dealershipId,
    userId: input.userId,
    roId: input.roId,
    lineId: input.lineId,
    entityType: 'repairLine',
    entityId: input.lineId,
    /** Story generation is always high priority for bay UX */
    priority: input.priority ?? 'high',
    allowInlineFallback: input.allowInlineFallback,
    payload: {
      technicianNotes: input.technicianNotes,
      warrantyStory: input.warrantyStory,
      preferredLanguage: input.preferredLanguage ?? 'en',
    },
  });
}

export async function enqueueVisionExtractionJob(input: {
  dealershipId: string;
  userId: string;
  roId?: string;
  imagePathnames: string[];
  kind?: 'vision.extract' | 'vision.diagnostic';
  allowInlineFallback?: boolean;
}): Promise<EnqueueAiJobResult> {
  return enqueueDurableAiJob({
    jobType: input.kind ?? 'vision.extract',
    dealershipId: input.dealershipId,
    userId: input.userId,
    roId: input.roId,
    entityType: 'vision',
    entityId: input.roId ?? input.imagePathnames[0] ?? null,
    allowInlineFallback: input.allowInlineFallback,
    payload: { imagePathnames: input.imagePathnames },
  });
}

export async function enqueueMpiReportJob(input: {
  dealershipId: string;
  userId: string;
  inspectionId: string;
  allowInlineFallback?: boolean;
}): Promise<EnqueueAiJobResult> {
  return enqueueDurableAiJob({
    jobType: 'mpi.report',
    dealershipId: input.dealershipId,
    userId: input.userId,
    entityType: 'videoInspection',
    entityId: input.inspectionId,
    allowInlineFallback: input.allowInlineFallback,
    payload: { inspectionId: input.inspectionId },
  });
}

export function getQueueMaxAttempts(): number {
  return AI_QUEUE_MAX_ATTEMPTS;
}

/** Mark running before handler body (idempotent if already running). */
export async function beginQueueJobProcessing(jobId: string): Promise<void> {
  await markAiJobRunning(jobId);
}

/**
 * Manager manual retry — create a new durable job from a failed/cancelled row.
 * Story jobs re-load line context from D1 (payload is not stored on AiJob).
 */
export async function retryDurableAiJob(input: {
  jobId: string;
  dealershipId: string;
  /** Manager performing the retry (audit actor if original user missing). */
  actorUserId: string;
}): Promise<EnqueueAiJobResult> {
  const { getAiJobForDealership } = await import('@/lib/aiJobs/service');
  const { getRlsDb } = await import('@/lib/apex/rlsContext');

  const existing = await getAiJobForDealership(input.jobId, input.dealershipId);
  if (!existing) {
    throw new Error('Job not found');
  }
  if (existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new Error('Only failed or cancelled jobs can be retried');
  }

  const userId = existing.technicianId?.trim() || input.actorUserId;
  const kind = existing.kind;

  if (kind === 'story.generate') {
    const lineId = existing.entityId?.trim() || '';
    if (!lineId) throw new Error('Story job missing repair line id');
    const line = await getRlsDb().repairLine.findFirst({
      where: {
        id: lineId,
        repairOrder: { dealershipId: input.dealershipId },
      },
      select: { id: true, repairOrderId: true },
    });
    if (!line?.repairOrderId) throw new Error('Repair line not found for retry');
    return enqueueStoryGenerationJob({
      dealershipId: input.dealershipId,
      userId,
      roId: line.repairOrderId,
      lineId: line.id,
      priority: 'high',
    });
  }

  if (kind === 'mpi.report' || kind === 'video.report') {
    const inspectionId = existing.entityId?.trim() || '';
    if (!inspectionId) throw new Error('MPI job missing inspection id');
    return enqueueMpiReportJob({
      dealershipId: input.dealershipId,
      userId,
      inspectionId,
    });
  }

  if (kind === 'hub.summarize') {
    return enqueueDurableAiJob({
      jobType: 'hub.summarize',
      dealershipId: input.dealershipId,
      userId,
      entityType: existing.entityType,
      entityId: existing.entityId,
      priority: 'normal',
      payload: {},
    });
  }

  throw new Error(
    kind.startsWith('vision.')
      ? 'Vision jobs cannot be retried without image pathnames — re-run the scan'
      : `Retry not supported for job kind: ${kind}`
  );
}
