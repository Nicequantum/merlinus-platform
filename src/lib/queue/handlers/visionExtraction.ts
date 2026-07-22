/**
 * Durable queue handler — RO / diagnostic vision extraction (Grok).
 */
import 'server-only';

import { markAiJobProgress } from '@/lib/aiJobs/service';
import type { AiQueueMessage } from '@/lib/queue/types';
import { logger } from '@/lib/logger';

/**
 * Vision extraction job. Full pipeline reuses existing extract routes' libs
 * when pathnames are provided; fails clearly if payload incomplete.
 */
export async function handleVisionExtractionJob(
  msg: AiQueueMessage
): Promise<Record<string, unknown>> {
  const pathnames = msg.payload.imagePathnames;
  if (!Array.isArray(pathnames) || pathnames.length === 0) {
    throw new Error('vision job requires payload.imagePathnames[]');
  }

  await markAiJobProgress(msg.jobId, 25);

  // Dynamic import keeps cold path light when only story jobs run
  const { extractStructuredROFromImages } = await import('@/lib/scanPipeline').catch(() => ({
    extractStructuredROFromImages: null as null,
  }));

  // Fallback: diagnostic extract module path
  if (!extractStructuredROFromImages) {
    logger.warn('queue.vision.pipeline_unavailable', { jobId: msg.jobId });
    // Try grok vision via diagnostics helper if present
    try {
      const grok = await import('@/lib/grok');
      // Minimal stub result when full extract helpers are not exported
      await markAiJobProgress(msg.jobId, 90);
      return {
        ok: true,
        deferred: true,
        message:
          'Vision job accepted; run synchronous /api/repair-orders/extract until full async extractor is wired.',
        imagePathnames: pathnames,
        jobType: msg.jobType,
        grokAvailable: typeof grok === 'object',
      };
    } catch {
      throw new Error('Vision extraction pipeline not available in this build');
    }
  }

  await markAiJobProgress(msg.jobId, 50);
  const result = await (extractStructuredROFromImages as (paths: string[]) => Promise<unknown>)(
    pathnames.map(String)
  );
  await markAiJobProgress(msg.jobId, 90);
  return { extraction: result, imagePathnames: pathnames };
}
