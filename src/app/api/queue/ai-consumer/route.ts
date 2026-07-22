/**
 * Durable AI queue consumer (HTTP bridge).
 *
 * Production: companion Worker `workers/ai-jobs-consumer` receives CF Queue batches
 * and POSTs each message here with Authorization: Bearer AI_QUEUE_CONSUMER_SECRET.
 *
 * Local: producers use inline scheduleBackgroundWork → processAiQueueMessage directly.
 */
import { processAiQueueMessage } from '@/lib/queue/processMessage';
import {
  AI_QUEUE_MAX_ATTEMPTS,
  aiQueueMessageSchema,
  type AiQueueMessage,
} from '@/lib/queue/types';
import { apiError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorizeConsumer(request: Request): boolean {
  const expected = process.env.AI_QUEUE_CONSUMER_SECRET?.trim();
  if (!expected) {
    // Dev convenience: allow when secret unset AND not production
    if (process.env.NODE_ENV !== 'production') return true;
    return false;
  }
  const auth = request.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() === expected;
  }
  return request.headers.get('x-ai-queue-secret')?.trim() === expected;
}

export async function POST(request: Request) {
  const rateLimited = await checkRateLimit(request, 'queue.ai_consumer', RATE_LIMITS.generate);
  if (rateLimited) return rateLimited;

  if (!authorizeConsumer(request)) {
    return apiError('Unauthorized queue consumer', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('Invalid JSON body', 400);
  }

  // Support single message or { messages: [...] } batch
  const messages: unknown[] = Array.isArray((body as { messages?: unknown })?.messages)
    ? ((body as { messages: unknown[] }).messages as unknown[])
    : [body];

  const results = [];
  for (const raw of messages) {
    // CF Queue consumer may wrap body
    const candidate =
      raw && typeof raw === 'object' && 'body' in (raw as object)
        ? (raw as { body: unknown }).body
        : raw;

    const parsed = aiQueueMessageSchema.safeParse(candidate);
    if (!parsed.success) {
      results.push({ ok: false, error: 'invalid_message', retryable: false });
      continue;
    }

    const msg: AiQueueMessage = parsed.data;
    const result = await processAiQueueMessage(msg, { source: 'http_consumer' });
    results.push(result);

    if (!result.ok && result.retryable && msg.attempt < AI_QUEUE_MAX_ATTEMPTS) {
      // Signal companion worker to retry (non-2xx)
      logger.warn('ai_queue.consumer_retry_signal', {
        jobId: result.jobId,
        attempt: msg.attempt,
      });
      return Response.json(
        { ok: false, results, retry: true },
        { status: 503, headers: { 'Retry-After': String(Math.min(60, 2 ** msg.attempt)) } }
      );
    }
  }

  const anyFail = results.some((r) => !r.ok);
  return Response.json(
    { ok: !anyFail, results },
    { status: anyFail ? 200 : 200 } // permanent fails ack; companion acks on 2xx
  );
}
