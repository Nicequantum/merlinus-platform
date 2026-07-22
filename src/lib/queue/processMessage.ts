/**
 * Dispatch AI queue messages to modular handlers.
 */
import 'server-only';

import * as Sentry from '@sentry/nextjs';
import {
  markAiJobFailed,
  markAiJobProgress,
  markAiJobRunning,
  markAiJobSucceeded,
} from '@/lib/aiJobs/service';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';
import { handleStoryGenerationJob } from '@/lib/queue/handlers/storyGeneration';
import { handleVisionExtractionJob } from '@/lib/queue/handlers/visionExtraction';
import { handleMpiReportJob } from '@/lib/queue/handlers/mpiReport';
import { handleHubSummarizeJob } from '@/lib/queue/handlers/hubSummarize';
import { recordQueueComplete, recordQueueFail } from '@/lib/queue/metrics';
import {
  AI_QUEUE_MAX_ATTEMPTS,
  aiQueueMessageSchema,
  type AiQueueMessage,
} from '@/lib/queue/types';

export type ProcessSource = 'queue' | 'inline' | 'http_consumer';

export interface ProcessAiQueueResult {
  ok: boolean;
  jobId: string;
  /** When false, CF Queue should retry the message */
  retryable: boolean;
  error?: string;
}

async function loadJobStatus(jobId: string): Promise<string | null> {
  return withRlsBypass(async () => {
    const row = await getRlsDb().aiJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return row?.status ?? null;
  });
}

/**
 * Process one queue message. Idempotent: skips if already succeeded.
 */
export async function processAiQueueMessage(
  raw: unknown,
  options?: { source?: ProcessSource }
): Promise<ProcessAiQueueResult> {
  const source = options?.source ?? 'queue';
  const parsed = aiQueueMessageSchema.safeParse(raw);
  if (!parsed.success) {
    logger.error('ai_queue.invalid_message', { issues: parsed.error.flatten() });
    return { ok: false, jobId: 'unknown', retryable: false, error: 'Invalid queue message' };
  }

  const msg: AiQueueMessage = parsed.data;
  const { jobId, jobType, attempt } = msg;

  logger.info('ai_queue.job_start', {
    jobId,
    jobType,
    attempt,
    source,
    dealershipId: msg.dealershipId,
  });

  try {
    const status = await loadJobStatus(jobId);
    if (status === 'succeeded') {
      logger.info('ai_queue.job_already_succeeded', { jobId });
      return { ok: true, jobId, retryable: false };
    }
    if (status === 'cancelled') {
      logger.info('ai_queue.job_cancelled_skip', { jobId });
      return { ok: false, jobId, retryable: false, error: 'Job cancelled' };
    }
    if (status === 'failed' && attempt >= AI_QUEUE_MAX_ATTEMPTS) {
      return { ok: false, jobId, retryable: false, error: 'Job already failed permanently' };
    }

    await withRlsBypass(async () => {
      await markAiJobRunning(jobId);
      await markAiJobProgress(jobId, 10);
    });

    let result: unknown;
    switch (jobType) {
      case 'story.generate':
        result = await handleStoryGenerationJob(msg);
        break;
      case 'vision.extract':
      case 'vision.diagnostic':
        result = await handleVisionExtractionJob(msg);
        break;
      case 'mpi.report':
        result = await handleMpiReportJob(msg);
        break;
      case 'hub.summarize':
        result = await handleHubSummarizeJob(msg);
        break;
      default:
        throw new Error(`Unsupported jobType: ${jobType}`);
    }

    await withRlsBypass(async () => {
      await markAiJobSucceeded(jobId, result);
    });

    try {
      const auditAction =
        jobType === 'story.generate'
          ? ('story.generate' as const)
          : jobType === 'mpi.report'
            ? ('video.report_generate' as const)
            : jobType === 'vision.diagnostic'
              ? ('diagnostics.extract' as const)
              : jobType === 'vision.extract'
                ? ('ro.extract' as const)
                : ('story.generate' as const);
      await withRlsBypass(async () => {
        await writeAuditedAccess({
          action: auditAction,
          dealershipId: msg.dealershipId,
          technicianId: msg.userId,
          entityType: 'aiJob',
          entityId: jobId,
          metadata: {
            jobType,
            source,
            attempt,
            outcome: 'succeeded',
            aiQueue: true,
          },
        });
      });
    } catch {
      // audit best-effort
    }

    recordQueueComplete(jobType);
    logger.info('ai_queue.job_complete', { jobId, jobType, attempt, source });
    return { ok: true, jobId, retryable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = attempt < AI_QUEUE_MAX_ATTEMPTS;
    recordQueueFail(jobType, retryable);

    logger.error('ai_queue.job_fail', {
      jobId,
      jobType,
      attempt,
      retryable,
      source,
      error: message,
    });

    Sentry.captureException(error instanceof Error ? error : new Error(message), {
      tags: {
        ai_queue: 'job_fail',
        jobType,
        retryable: String(retryable),
      },
      extra: { jobId, attempt, dealershipId: msg.dealershipId },
    });

    if (!retryable) {
      await withRlsBypass(async () => {
        await markAiJobFailed(jobId, message.slice(0, 500));
      });
      try {
        await withRlsBypass(async () => {
          await writeAuditedAccess({
            action: 'story.generate',
            dealershipId: msg.dealershipId,
            technicianId: msg.userId,
            entityType: 'aiJob',
            entityId: jobId,
            metadata: {
              jobType,
              source,
              attempt,
              outcome: 'failed_permanent',
              error: message.slice(0, 200),
              deadLetter: true,
              aiQueue: true,
            },
          });
        });
      } catch {
        // ignore
      }
    } else {
      // Leave status running/queued so a retry can proceed; surface attempt in progress
      await withRlsBypass(async () => {
        await markAiJobProgress(jobId, Math.min(40, 10 + attempt * 10));
      });
    }

    return { ok: false, jobId, retryable, error: message };
  }
}
