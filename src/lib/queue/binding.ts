/**
 * Resolve Cloudflare Queue binding AI_JOBS_QUEUE from OpenNext / workerd context.
 */
import 'server-only';

export const AI_JOBS_QUEUE_BINDING = 'AI_JOBS_QUEUE' as const;

export type QueueSendOptions = {
  contentType?: string;
  delaySeconds?: number;
};

export type AiJobsQueueLike = {
  send: (body: unknown, options?: QueueSendOptions) => Promise<void>;
  sendBatch?: (messages: { body: unknown; options?: QueueSendOptions }[]) => Promise<void>;
};

function isQueue(value: unknown): value is AiJobsQueueLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AiJobsQueueLike).send === 'function'
  );
}

function readEnvQueue(): AiJobsQueueLike | null {
  try {
    const ctx = Reflect.get(globalThis, Symbol.for('__cloudflare-context__')) as
      | { env?: Record<string, unknown> }
      | undefined;
    const q = ctx?.env?.[AI_JOBS_QUEUE_BINDING];
    if (isQueue(q)) return q;
  } catch {
    // outside request
  }

  try {
    // eslint-disable-next-line no-new-func
    const req = Function('return typeof require !== "undefined" ? require : null')() as NodeRequire | null;
    if (req) {
      try {
        const { getCloudflareContext } = req('@opennextjs/cloudflare') as {
          getCloudflareContext?: (o?: { async?: boolean }) => { env?: Record<string, unknown> };
        };
        const ctx = getCloudflareContext?.({ async: false });
        const q = ctx?.env?.[AI_JOBS_QUEUE_BINDING];
        if (isQueue(q)) return q;
      } catch {
        // package missing
      }
      try {
        const workers = req('cloudflare:workers') as { env?: Record<string, unknown> };
        const q = workers?.env?.[AI_JOBS_QUEUE_BINDING];
        if (isQueue(q)) return q;
      } catch {
        // not workerd
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/** True when durable Cloudflare Queue producer is available. */
export function isAiJobsQueueConfigured(): boolean {
  if (process.env.AI_JOBS_QUEUE_FORCE_OFF === '1' || process.env.AI_JOBS_QUEUE_FORCE_OFF === 'true') {
    return false;
  }
  // Explicit env for tests / local simulation without CF binding
  if (process.env.AI_JOBS_QUEUE_ENABLED === '0' || process.env.AI_JOBS_QUEUE_ENABLED === 'false') {
    return false;
  }
  return isQueue(readEnvQueue());
}

export function getAiJobsQueue(): AiJobsQueueLike | null {
  if (process.env.AI_JOBS_QUEUE_FORCE_OFF === '1' || process.env.AI_JOBS_QUEUE_FORCE_OFF === 'true') {
    return null;
  }
  return readEnvQueue();
}
