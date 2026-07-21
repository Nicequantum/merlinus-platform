/**
 * P0 — Owner seed secret lifecycle (one-time bootstrap only).
 *
 * OWNER_SEED_PASSWORD* and MULTI_ROOFTOP_SEED_PASSWORD must never remain on a
 * long-lived production Worker. Bootstrap either:
 *   - locally via `npm run db:seed` / scripts/seed-owner-d1-remote.mjs, or
 *   - one-shot with ALLOW_OWNER_SEED_BOOTSTRAP=1, then delete secrets from CF.
 *
 * Runtime cannot delete Cloudflare dashboard secrets — only process.env slots
 * for the current isolate. Operators must `wrangler secret delete`.
 */

/** Password-bearing seed keys that must leave production after bootstrap. */
export const OWNER_SEED_PASSWORD_ENV_KEYS = [
  'OWNER_SEED_PASSWORD',
  'OWNER_SEED_PASSWORD_2',
  'MULTI_ROOFTOP_SEED_PASSWORD',
] as const;

/** Identity / name keys cleared from process.env after a successful seed attempt. */
export const OWNER_SEED_IDENTITY_ENV_KEYS = [
  'OWNER_SEED_EMAIL',
  'OWNER_SEED_EMAIL_2',
  'OWNER_SEED_NAME',
  'OWNER_SEED_NAME_2',
  'MULTI_ROOFTOP_SEED_USERNAME',
  'MULTI_ROOFTOP_SEED_NAME',
] as const;

export const ALL_CLEARABLE_OWNER_SEED_ENV_KEYS = [
  ...OWNER_SEED_PASSWORD_ENV_KEYS,
  ...OWNER_SEED_IDENTITY_ENV_KEYS,
] as const;

export type OwnerSeedPasswordEnvKey = (typeof OWNER_SEED_PASSWORD_ENV_KEYS)[number];

export function isTruthyEnvFlag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * One-shot production bootstrap break-glass.
 * After owners exist, remove this flag and all OWNER_SEED_PASSWORD* secrets.
 */
export function isOwnerSeedBootstrapAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isTruthyEnvFlag(env.ALLOW_OWNER_SEED_BOOTSTRAP);
}

export function isProductionLikeEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.NODE_ENV === 'production' ||
    env.VERCEL_ENV === 'production' ||
    isTruthyEnvFlag(env.MERLIN_PRODUCTION)
  );
}

function envValuePresent(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw == null) return false;
  return String(raw).trim().length > 0;
}

/** Password seed secrets currently present (names only — never values). */
export function listPresentOwnerSeedPasswordKeys(
  env: NodeJS.ProcessEnv = process.env
): OwnerSeedPasswordEnvKey[] {
  return OWNER_SEED_PASSWORD_ENV_KEYS.filter((key) => envValuePresent(env, key));
}

export interface OwnerSeedSecretPolicyResult {
  ok: boolean;
  /** Production + passwords present + bootstrap not allowed → policy violation. */
  violation: boolean;
  production: boolean;
  bootstrapAllowed: boolean;
  presentPasswordKeys: OwnerSeedPasswordEnvKey[];
  message: string;
}

/**
 * Evaluate whether password-bearing owner seed secrets are allowed.
 * Dev/test: always ok (local seed workflows).
 * Production without ALLOW_OWNER_SEED_BOOTSTRAP: passwords → violation.
 */
export function evaluateOwnerSeedSecretPolicy(
  env: NodeJS.ProcessEnv = process.env
): OwnerSeedSecretPolicyResult {
  const production = isProductionLikeEnv(env);
  const bootstrapAllowed = isOwnerSeedBootstrapAllowed(env);
  const presentPasswordKeys = listPresentOwnerSeedPasswordKeys(env);

  if (presentPasswordKeys.length === 0) {
    return {
      ok: true,
      violation: false,
      production,
      bootstrapAllowed,
      presentPasswordKeys,
      message: 'No owner seed password secrets present in environment',
    };
  }

  if (!production) {
    return {
      ok: true,
      violation: false,
      production,
      bootstrapAllowed,
      presentPasswordKeys,
      message: `Owner seed passwords present in non-production (${presentPasswordKeys.join(', ')}) — expected for local bootstrap`,
    };
  }

  if (bootstrapAllowed) {
    return {
      ok: true,
      violation: false,
      production,
      bootstrapAllowed,
      presentPasswordKeys,
      message: `ALLOW_OWNER_SEED_BOOTSTRAP enabled — temporary production seed allowed for: ${presentPasswordKeys.join(', ')}. Delete secrets after owners exist.`,
    };
  }

  return {
    ok: false,
    violation: true,
    production,
    bootstrapAllowed,
    presentPasswordKeys,
    message:
      `Production still has owner seed password secret(s): ${presentPasswordKeys.join(', ')}. ` +
      'These are one-time bootstrap only. Delete from Cloudflare Worker secrets ' +
      '(`npx wrangler secret delete OWNER_SEED_PASSWORD`, etc.) and set platform ' +
      'operators via APEX_PLATFORM_OWNER_EMAILS. One-shot bootstrap: ALLOW_OWNER_SEED_BOOTSTRAP=1 then remove.',
  };
}

/**
 * Whether instrumentation may create-missing owners from env.
 * Production: only with ALLOW_OWNER_SEED_BOOTSTRAP. Never on every cold start otherwise.
 */
export function shouldRunOwnerSeedOnStartup(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isProductionLikeEnv(env)) return true;
  return isOwnerSeedBootstrapAllowed(env);
}

/**
 * Clear owner seed values from process.env for this isolate after seed.
 * Does NOT remove Cloudflare dashboard secrets (operator must delete those).
 * Returns keys that were cleared.
 */
export function clearOwnerSeedSecretsFromProcessEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const cleared: string[] = [];
  for (const key of ALL_CLEARABLE_OWNER_SEED_ENV_KEYS) {
    if (envValuePresent(env, key)) {
      delete env[key];
      cleared.push(key);
    }
  }
  // One-shot flag should not linger in-process either after seed attempt.
  if (envValuePresent(env, 'ALLOW_OWNER_SEED_BOOTSTRAP')) {
    delete env.ALLOW_OWNER_SEED_BOOTSTRAP;
    cleared.push('ALLOW_OWNER_SEED_BOOTSTRAP');
  }
  return cleared;
}

export const OWNER_SEED_SECRET_DELETE_HINT =
  'After bootstrap: npx wrangler secret delete OWNER_SEED_PASSWORD; ' +
  'also delete OWNER_SEED_PASSWORD_2 / MULTI_ROOFTOP_SEED_PASSWORD if set; ' +
  'remove ALLOW_OWNER_SEED_BOOTSTRAP; keep APEX_PLATFORM_OWNER_EMAILS for national operators.';
