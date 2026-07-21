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

    // P2-3 — rate-limit KV is Cloudflare Workers KV_STORE (wrangler.toml), not Vercel KV.
    const { isKvConfigured, isProductionEnv } = await import('./lib/rate-limit');
    const { isApexPlatformMode } = await import('./lib/platformMode');
    const { isWorkersKvConfigured } = await import('./lib/storage/workersKv');
    const workersKv = isWorkersKvConfigured();
    if (isProductionEnv() && isApexPlatformMode() && !isKvConfigured()) {
      logger.error('rate_limit.apex_kv_required', {
        message:
          'Apex production missing Workers KV binding KV_STORE. Auth/API rate limits fail closed (503). Add [[kv_namespaces]] binding = "KV_STORE" in wrangler.toml, create the namespace, redeploy.',
        binding: 'KV_STORE',
        workersKv,
      });
    } else if (isProductionEnv() && !isKvConfigured()) {
      logger.error('rate_limit.production_kv_missing', {
        message:
          'Production Worker missing KV_STORE binding — auth rate limits fall back to per-isolate memory (weaker multi-instance protection). Configure wrangler.toml [[kv_namespaces]] binding = "KV_STORE" and redeploy.',
        binding: 'KV_STORE',
        workersKv,
      });
    } else if (isKvConfigured()) {
      logger.info('rate_limit.kv_ready', {
        configured: true,
        apex: isApexPlatformMode(),
        backend: workersKv ? 'workers_kv_store' : 'configured',
      });
    } else {
      logger.warn('rate_limit.kv_not_configured', {
        message:
          'KV_STORE not available — local/dev in-memory rate limits only (ok for single-process)',
      });
    }

    const { logSupabaseProductionReadiness } = await import('./lib/supabase');
    logSupabaseProductionReadiness();

    const { warmDatabaseConnectionInBackground } = await import('./lib/db');
    warmDatabaseConnectionInBackground();

    // P0-5: when schema.prisma is on disk (Node/local), validate registry vs schema.
    // Cloudflare Workers do not ship the schema file — CI/`npm run check:rls-registry` is the gate.
    if (!onCloudflare) {
      try {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const { validateRlsRegistryAgainstSchema, formatRlsRegistryIssues } = await import(
          './lib/apex/rlsRegistryValidation'
        );
        const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');
        const schema = readFileSync(schemaPath, 'utf8');
        const rlsCheck = validateRlsRegistryAgainstSchema(schema);
        if (!rlsCheck.ok) {
          logger.error('merlin.startup.rls_registry_invalid', {
            summary: rlsCheck.summary,
            issueCount: rlsCheck.issues.length,
            detail: formatRlsRegistryIssues(rlsCheck),
          });
        } else {
          logger.info('merlin.startup.rls_registry_ok', { summary: rlsCheck.summary });
        }
      } catch (error) {
        logger.warn('merlin.startup.rls_registry_check_skipped', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // P0: owner seed password secrets must not remain on production Workers.
    // Never hard-throw on Cloudflare (blank page on cold start) — health/ready-to-deploy fail closed.
    const {
      evaluateOwnerSeedSecretPolicy,
      shouldRunOwnerSeedOnStartup,
      OWNER_SEED_SECRET_DELETE_HINT,
    } = await import('./lib/apex/ownerSeedSecurity');
    const ownerSeedPolicy = evaluateOwnerSeedSecretPolicy();
    if (ownerSeedPolicy.violation) {
      logger.error('merlin.startup.owner_seed_secrets_forbidden', {
        presentPasswordKeys: ownerSeedPolicy.presentPasswordKeys,
        message: ownerSeedPolicy.message,
        hint: OWNER_SEED_SECRET_DELETE_HINT,
      });
      // Non-CF Node production: fail closed so misconfigured hosts never serve traffic.
      if (isProduction && !onCloudflare) {
        throw new Error(ownerSeedPolicy.message);
      }
    } else if (
      ownerSeedPolicy.production &&
      ownerSeedPolicy.presentPasswordKeys.length > 0 &&
      ownerSeedPolicy.bootstrapAllowed
    ) {
      logger.warn('merlin.startup.owner_seed_bootstrap_window', {
        presentPasswordKeys: ownerSeedPolicy.presentPasswordKeys,
        message: ownerSeedPolicy.message,
        hint: OWNER_SEED_SECRET_DELETE_HINT,
      });
    }

    // Create-missing national owners only when allowed (dev always; prod only with
    // ALLOW_OWNER_SEED_BOOTSTRAP). Never re-seed on every production cold start.
    if (isApexPlatformEnvActive() && shouldRunOwnerSeedOnStartup()) {
      void import('./lib/apex/seedOwnerAccounts')
        .then(({ ensureApexPlatformOwners }) => ensureApexPlatformOwners())
        .catch((error: unknown) => {
          logger.warn('apex.owner_seed_startup_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } else if (isApexPlatformEnvActive() && isProduction) {
      logger.info('apex.owner_seed_startup_skipped', {
        message:
          'Production owner seed skipped — use one-time ALLOW_OWNER_SEED_BOOTSTRAP or scripts/seed-owner-d1-remote.mjs',
      });
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;