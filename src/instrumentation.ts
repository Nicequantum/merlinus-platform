import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Polyfill ALS on globalThis so Edge-safe requestContext can use it without node: imports.
    const { AsyncLocalStorage } = await import('node:async_hooks');
    (globalThis as typeof globalThis & { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage =
      AsyncLocalStorage;

    await import('./sentry.server.config');

    const { loadApexEnvFile, isApexPlatformEnvActive } = await import('./lib/apex/loadApexEnv');
    loadApexEnvFile({ override: true });

    // D1 binding at runtime; local file URL for tooling (never Postgres).
    const { applyResolvedDatabaseEnv } = await import('./lib/apex/databaseConfig');
    const dbConfig = applyResolvedDatabaseEnv();

    const { getRuntimeConfig, validateEnvironment } = await import('./lib/env');
    const { PROMPT_VERSION } = await import('./prompts/version');
    const isProduction =
      process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    // On Cloudflare Workers, secrets are dashboard vars — do not hard-throw during
    // instrumentation or the entire Worker returns a blank page on cold start.
    const onCloudflare =
      process.env.CF_PAGES === '1' ||
      process.env.CF_PAGES === 'true' ||
      typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined';
    const result = validateEnvironment({
      throwOnError: isProduction && !onCloudflare,
      production: isProduction,
    });
    const { logger } = await import('./lib/logger');
    const config = getRuntimeConfig(PROMPT_VERSION);
    logger.info('merlin.startup', {
      version: config.appVersion,
      promptVersion: config.promptVersion,
      commit: config.buildCommit,
      maintenance: config.maintenanceMode,
      platformMode: process.env.PLATFORM_MODE || process.env.NEXT_PUBLIC_PLATFORM_MODE || 'merlinus',
      dbBackend: dbConfig.backend,
    });
    if (!result.valid) {
      logger.error('merlin.startup.env_invalid');
    }

    // Phase 6.4/6.5 — surface KV readiness; Apex production fails closed without KV.
    const { isKvConfigured, isProductionEnv } = await import('./lib/rate-limit');
    const { isApexPlatformMode } = await import('./lib/platformMode');
    if (isProductionEnv() && isApexPlatformMode() && !isKvConfigured()) {
      logger.error('rate_limit.apex_kv_required', {
        message:
          'Apex production missing KV_REST_API_URL / KV_REST_API_TOKEN. Auth and API rate limits refuse traffic (503) until Vercel KV is connected. Storage → Create KV → connect project → redeploy.',
      });
    } else if (isProductionEnv() && !isKvConfigured()) {
      logger.error('rate_limit.production_kv_missing', {
        message:
          'Production deployment missing KV_REST_API_URL / KV_REST_API_TOKEN. Auth rate limits use per-instance memory fallback. Connect Vercel KV (Upstash) and redeploy.',
      });
    } else if (isKvConfigured()) {
      logger.info('rate_limit.kv_ready', { configured: true, apex: isApexPlatformMode() });
    } else {
      logger.warn('rate_limit.kv_not_configured', {
        message: 'KV not set — local/dev in-memory rate limits only',
      });
    }

    const { logSupabaseProductionReadiness } = await import('./lib/supabase');
    logSupabaseProductionReadiness();

    const { warmDatabaseConnectionInBackground } = await import('./lib/db');
    warmDatabaseConnectionInBackground();

    // Create missing national owners from env only (never rewrites password hashes).
    if (isApexPlatformEnvActive()) {
      void import('./lib/apex/seedOwnerAccounts')
        .then(({ ensureApexPlatformOwners }) => ensureApexPlatformOwners())
        .catch((error: unknown) => {
          logger.warn('apex.owner_seed_startup_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;