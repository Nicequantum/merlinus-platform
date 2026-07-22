/**
 * Cloudflare Queue consumer → HTTP bridge to OpenNext app.
 * Forwards each message to POST /api/queue/ai-consumer on the main Worker.
 */

export interface Env {
  APP_BASE_URL: string;
  AI_QUEUE_CONSUMER_SECRET?: string;
}

interface QueueMessage {
  id: string;
  body: unknown;
  attempts: number;
  ack: () => void;
  retry: (opts?: { delaySeconds?: number }) => void;
}

interface MessageBatch {
  messages: QueueMessage[];
  queue: string;
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const base = (env.APP_BASE_URL || '').replace(/\/$/, '');
    if (!base) {
      console.error('APP_BASE_URL missing — cannot process AI jobs');
      for (const msg of batch.messages) msg.retry();
      return;
    }

    const secret = env.AI_QUEUE_CONSUMER_SECRET?.trim() || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (secret) headers.Authorization = `Bearer ${secret}`;

    for (const msg of batch.messages) {
      try {
        // Bump attempt in body for handler retry accounting
        const body =
          msg.body && typeof msg.body === 'object'
            ? {
                ...(msg.body as Record<string, unknown>),
                attempt: Math.max(
                  1,
                  Number((msg.body as { attempt?: number }).attempt) || 1,
                  msg.attempts
                ),
              }
            : msg.body;

        const res = await fetch(`${base}/api/queue/ai-consumer`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as { retry?: boolean };
          if (data.retry) {
            msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
          } else {
            msg.ack();
          }
        } else if (res.status === 503) {
          msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
        } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          // Permanent client error — ack to avoid poison loop (handler marked failed)
          console.error('ai consumer permanent failure', res.status, await res.text());
          msg.ack();
        } else {
          msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
        }
      } catch (error) {
        console.error('ai consumer network error', error);
        msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts) });
      }
    }
  },
};
