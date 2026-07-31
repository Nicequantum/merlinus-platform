/**
 * Merlinus ops cron — hits main Worker nightly + morning maintenance endpoints.
 *
 * Deploy:
 *   npx wrangler deploy -c workers/ops-cron/wrangler.toml
 * Secrets:
 *   OPS_MAINTENANCE_SECRET or AI_QUEUE_CONSUMER_SECRET
 *   APP_BASE_URL=https://your-production-host
 *
 * Types are local (same pattern as workers/ai-jobs-consumer) so the main
 * Next.js `tsc` / `next build` does not require @cloudflare/workers-types.
 */

export interface Env {
  APP_BASE_URL?: string;
  OPS_MAINTENANCE_SECRET?: string;
  AI_QUEUE_CONSUMER_SECRET?: string;
}

/** Minimal scheduled event shape — avoid CF global types in Next typecheck. */
interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
}

async function run(env: Env, mode: 'nightly' | 'morning'): Promise<void> {
  const base = (env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    console.error(JSON.stringify({ msg: 'ops_cron.missing_base_url' }));
    return;
  }
  const secret = env.OPS_MAINTENANCE_SECRET || env.AI_QUEUE_CONSUMER_SECRET || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(`${base}/api/ops/nightly-maintenance`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode }),
  });
  const text = await res.text();
  console.log(
    JSON.stringify({
      msg: 'ops_cron.run',
      mode,
      status: res.status,
      body: text.slice(0, 500),
    })
  );
}

export default {
  async scheduled(controller: ScheduledControllerLike, env: Env): Promise<void> {
    const hour = new Date(controller.scheduledTime).getUTCHours();
    const mode: 'nightly' | 'morning' =
      controller.cron.includes('10 ') || hour === 10 ? 'morning' : 'nightly';
    await run(env, mode);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      const mode = url.searchParams.get('mode') === 'morning' ? 'morning' : 'nightly';
      await run(env, mode);
      return new Response(JSON.stringify({ ok: true, mode }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('merlinus ops-cron', { status: 200 });
  },
};
