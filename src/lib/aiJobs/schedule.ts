/**
 * P1-1 — Schedule background work without blocking the HTTP response.
 * Prefer Cloudflare waitUntil when available; otherwise fire-and-forget.
 */
import { logger } from '@/lib/logger';

export async function scheduleBackgroundWork(
  label: string,
  work: () => Promise<void>
): Promise<void> {
  const run = async () => {
    try {
      await work();
    } catch (error) {
      logger.error('ai_job.background_failed', {
        label,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    const waitUntil =
      // OpenNext / workerd shapes
      (ctx as { ctx?: { waitUntil?: (p: Promise<unknown>) => void } })?.ctx?.waitUntil ||
      (ctx as { waitUntil?: (p: Promise<unknown>) => void })?.waitUntil;
    if (typeof waitUntil === 'function') {
      waitUntil(run());
      return;
    }
  } catch {
    // Not on CF or context unavailable
  }

  void run();
}
