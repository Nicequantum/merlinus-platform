import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import {
  AI_QUEUE_JOB_TYPES,
  AI_QUEUE_MAX_ATTEMPTS,
  aiQueueMessageSchema,
  queueRetryDelayMs,
} from '@/lib/queue/types';
import { isAiJobsQueueConfigured } from '@/lib/queue/binding';
import { luxuryPhaseFromProgress } from '@/lib/queue/jobEventsHub';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Durable AI queue — schemas & producers', () => {
  it('parses a valid story.generate message', () => {
    const msg = aiQueueMessageSchema.parse({
      jobId: 'job_1',
      jobType: 'story.generate',
      dealershipId: 'd1',
      userId: 'u1',
      roId: 'ro1',
      lineId: 'line1',
      priority: 'normal',
      attempt: 1,
      payload: { technicianNotes: 'notes' },
    });
    assert.equal(msg.jobType, 'story.generate');
    assert.equal(msg.payload.technicianNotes, 'notes');
  });

  it('rejects unknown job types', () => {
    assert.throws(() =>
      aiQueueMessageSchema.parse({
        jobId: 'j',
        jobType: 'nope',
        dealershipId: 'd',
        userId: 'u',
      })
    );
  });

  it('documents job types and max attempts', () => {
    assert.ok(AI_QUEUE_JOB_TYPES.includes('story.generate'));
    assert.ok(AI_QUEUE_JOB_TYPES.includes('mpi.report'));
    assert.equal(AI_QUEUE_MAX_ATTEMPTS, 3);
    assert.ok(queueRetryDelayMs(1) >= 1000);
    assert.ok(queueRetryDelayMs(5) <= 60_000);
  });

  it('queue is not configured in unit test env by default', () => {
    assert.equal(isAiJobsQueueConfigured(), false);
  });

  it('wrangler producer binding AI_JOBS_QUEUE exists', () => {
    const toml = readSrc('wrangler.toml');
    assert.match(toml, /AI_JOBS_QUEUE/);
    assert.match(toml, /merlinus-ai-jobs/);
  });

  it('story generate route enqueues durable jobs', () => {
    const src = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts');
    assert.match(src, /enqueueStoryGenerationJob/);
    assert.match(src, /isAiJobsQueueConfigured/);
    assert.match(src, /pollUrl/);
  });

  it('handlers and consumer route exist', () => {
    assert.match(readSrc('src/lib/queue/handlers/storyGeneration.ts'), /handleStoryGenerationJob/);
    assert.match(readSrc('src/lib/queue/handlers/visionExtraction.ts'), /handleVisionExtractionJob/);
    assert.match(readSrc('src/lib/queue/handlers/mpiReport.ts'), /handleMpiReportJob/);
    assert.match(readSrc('src/app/api/queue/ai-consumer/route.ts'), /processAiQueueMessage/);
    assert.match(readSrc('src/app/api/queue/job-status/[jobId]/route.ts'), /getAiJobForTechnician/);
    assert.match(readSrc('workers/ai-jobs-consumer/src/index.ts'), /ai-consumer/);
  });

  it('client polls job status with phase toasts path', () => {
    assert.match(readSrc('src/lib/aiJobClient.ts'), /pollAiJobUntilDone/);
    assert.match(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts'), /pollAiJobUntilDone/);
    assert.match(readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts'), /async: true/);
  });

  it('SSE job-events route + client hook exist', () => {
    assert.match(
      readSrc('src/app/api/queue/job-events/[jobId]/route.ts'),
      /text\/event-stream/
    );
    assert.match(readSrc('src/hooks/useAiJobEvents.ts'), /EventSource/);
    assert.match(readSrc('src/lib/aiJobClient.ts'), /waitViaSse|preferSse/);
    assert.match(readSrc('src/lib/queue/jobEventsHub.ts'), /luxuryPhaseFromProgress/);
  });

  it('luxury bay UX uses technician-friendly errors + phased progress', () => {
    const client = readSrc('src/lib/aiJobClient.ts');
    assert.match(client, /technicianFriendlyJobError/);
    assert.match(client, /AI is writing your warranty story/);
    const workflow = readSrc('src/hooks/repairOrders/useROStoryWorkflow.ts');
    assert.match(workflow, /Contact Manager/);
    assert.match(workflow, /AI Thinking|ai_thinking/);
  });

  it('manager job monitor + cancel/retry APIs exist', () => {
    assert.match(readSrc('src/app/api/queue/jobs/route.ts'), /listDealershipAiJobs/);
    assert.match(readSrc('src/app/api/queue/jobs/[jobId]/cancel/route.ts'), /markAiJobCancelled/);
    assert.match(readSrc('src/app/api/queue/jobs/[jobId]/retry/route.ts'), /retryDurableAiJob/);
    assert.match(readSrc('src/components/ManagerJobsMonitor.tsx'), /listManagerAiJobs/);
    assert.match(readSrc('src/app/manager/jobs/page.tsx'), /ManagerJobsMonitor/);
    assert.match(readSrc('src/lib/queue/aiJobs.ts'), /priority: input\.priority \?\? 'high'/);
    assert.match(readSrc('src/lib/queue/aiJobs.ts'), /enqueueDurableAiJobBatch/);
  });

  it('health checks include queue depth, error rate, oldest job', () => {
    const health = readSrc('src/lib/healthChecks.ts');
    assert.match(health, /checkAiJobsQueueHealth/);
    assert.match(health, /errorRate24h|oldestQueued/);
    assert.match(health, /getGlobalAiJobQueueHealth|getDealershipJobHealthStats/);
    assert.match(readSrc('src/lib/queue/metrics.ts'), /recordQueueEnqueue/);
  });

  it('luxury phase mapping covers bay stages', () => {
    assert.equal(luxuryPhaseFromProgress('queued', 0), 'queued');
    assert.equal(luxuryPhaseFromProgress('running', 20), 'processing');
    assert.equal(luxuryPhaseFromProgress('running', 60), 'ai_thinking');
    assert.equal(luxuryPhaseFromProgress('succeeded', 100), 'complete');
    assert.equal(luxuryPhaseFromProgress('failed', 0), 'failed');
    assert.equal(luxuryPhaseFromProgress('cancelled', 0), 'cancelled');
  });
});
