/**
 * Centralized environment validation for Merlinus.
 * Called at Node startup (instrumentation) and before production builds (scripts/validate-env.mjs).
 */

import { getExposedPublicGrokEnvKeys } from '@/lib/grokApiKey.shared';
import { logger } from '@/lib/logger';
import { validateProductModuleEnvironment } from '@/lib/modules/envValidation';
import { isApexPlatformMode } from '@/lib/platformMode';
import { getSupabaseEnvConfig, isApexSupabaseProductionReady } from '@/lib/supabaseEnv';
import { APP_VERSION } from '@/lib/version';

const REQUIRED_ENV_VARS = [
  // DATABASE_URL is optional — D1 uses binding DB; local tooling defaults to file:./prisma/dev.db
  'DATA_ENCRYPTION_KEY',
  'SEARCH_HMAC_KEY',
  'SESSION_SECRET',
] as const;

/** Production hard requirement — RO and Xentry scanning cannot work without blob + vision AI. */
export const PRODUCTION_SCANNING_REQUIRED_ENV_VARS = [
  'BLOB_READ_WRITE_TOKEN',
  'GROK_API_KEY',
] as const;

/**
 * Phase 6.4 — Vercel KV / Upstash required for production distributed rate limiting
 * (especially auth.login / password routes). Without KV, multi-instance limits are per-instance only.
 */
export const PRODUCTION_KV_ENV_VARS = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'] as const;

export interface EnvironmentValidationResult {
  missing: string[];
  warnings: string[];
  /** NEXT_PUBLIC_* xAI keys — security violation; must be deleted from all environments. */
  forbiddenPublicKeys: string[];
  valid: boolean;
}

export interface RuntimeConfig {
  appVersion: string;
  promptVersion: string;
  buildCommit: string;
  buildDate: string;
  maintenanceMode: boolean;
  nodeEnv: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Local/legacy alias support: older Merlinus envs used ENCRYPTION_KEY.
 * Map to DATA_ENCRYPTION_KEY + SEARCH_HMAC_KEY when the modern names are unset
 * so `npm run dev` / `dev:apex` work without a manual rename.
 */
export function applyLegacyEncryptionEnvAliases(): string[] {
  const notes: string[] = [];
  const legacy = process.env.ENCRYPTION_KEY?.trim();
  if (!legacy || legacy.length < 32) return notes;

  if (!process.env.DATA_ENCRYPTION_KEY?.trim()) {
    process.env.DATA_ENCRYPTION_KEY = legacy;
    notes.push('DATA_ENCRYPTION_KEY aliased from legacy ENCRYPTION_KEY');
  }
  if (!process.env.SEARCH_HMAC_KEY?.trim()) {
    // Prefer a distinct search key when possible; fall back to legacy so RO blind-index still works.
    process.env.SEARCH_HMAC_KEY = legacy;
    notes.push(
      'SEARCH_HMAC_KEY aliased from legacy ENCRYPTION_KEY — set a dedicated SEARCH_HMAC_KEY (openssl rand -hex 32) for production'
    );
  }
  return notes;
}

/** True when MERLIN_MAINTENANCE_MODE is enabled — blocks AI routes and shows maintenance UI. */
export function isMaintenanceModeEnabled(): boolean {
  return isTruthyEnv(process.env.MERLIN_MAINTENANCE_MODE);
}

export function getBuildCommit(): string {
  return (
    process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    'dev'
  );
}

export function getBuildDate(): string {
  return process.env.NEXT_PUBLIC_BUILD_DATE?.trim() || new Date().toISOString();
}

export function getAppVersion(): string {
  return process.env.npm_package_version?.trim() || APP_VERSION;
}

export function validateEnvironment(options: { throwOnError?: boolean; production?: boolean } = {}): EnvironmentValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProduction = options.production ?? process.env.NODE_ENV === 'production';

  for (const note of applyLegacyEncryptionEnvAliases()) {
    warnings.push(note);
  }

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      missing.push(key);
    }
  }

  const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY?.trim();
  const searchHmacKey = process.env.SEARCH_HMAC_KEY?.trim();
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  // Phase 7.1 H6 — weak / duplicate secrets fail hard in production (especially Apex).
  const hardFailSecretQuality = isProduction;

  if (dataEncryptionKey) {
    if (dataEncryptionKey.length < 32) {
      const msg = 'DATA_ENCRYPTION_KEY is shorter than 32 characters';
      if (hardFailSecretQuality) missing.push('DATA_ENCRYPTION_KEY (too short)');
      else warnings.push(msg);
    } else if (!/^[0-9a-fA-F]{64}$/.test(dataEncryptionKey)) {
      const msg = 'DATA_ENCRYPTION_KEY should be 64 hex characters (openssl rand -hex 32)';
      if (hardFailSecretQuality) missing.push('DATA_ENCRYPTION_KEY (invalid format)');
      else warnings.push(msg);
    }
  }

  if (searchHmacKey) {
    if (searchHmacKey.length < 32) {
      const msg = 'SEARCH_HMAC_KEY is shorter than 32 characters';
      if (hardFailSecretQuality) missing.push('SEARCH_HMAC_KEY (too short)');
      else warnings.push(msg);
    } else if (!/^[0-9a-fA-F]{64}$/.test(searchHmacKey)) {
      const msg = 'SEARCH_HMAC_KEY should be 64 hex characters (openssl rand -hex 32)';
      if (hardFailSecretQuality) missing.push('SEARCH_HMAC_KEY (invalid format)');
      else warnings.push(msg);
    }
    if (dataEncryptionKey && searchHmacKey === dataEncryptionKey) {
      const msg = 'SEARCH_HMAC_KEY must differ from DATA_ENCRYPTION_KEY';
      if (hardFailSecretQuality) missing.push('SEARCH_HMAC_KEY (must differ from DATA_ENCRYPTION_KEY)');
      else warnings.push(msg);
    }
  }

  if (sessionSecret && sessionSecret.length < 32) {
    const msg = 'SESSION_SECRET is shorter than the recommended 32 characters';
    if (hardFailSecretQuality) missing.push('SESSION_SECRET (too short)');
    else warnings.push(msg);
  }

  for (const key of PRODUCTION_SCANNING_REQUIRED_ENV_VARS) {
    if (!process.env[key]?.trim()) {
      const scanMessage = `${key} not configured — RO and Xentry photo scanning disabled`;
      if (isProduction) {
        missing.push(key);
      } else {
        warnings.push(scanMessage);
      }
    }
  }

  const kvUrl = process.env.KV_REST_API_URL?.trim();
  const kvToken = process.env.KV_REST_API_TOKEN?.trim();
  const kvConfigured = Boolean(kvUrl && kvToken);
  const apexMode = isApexPlatformMode();
  if (!kvConfigured) {
    // Phase 6.5 — Apex production hard-requires distributed KV (no silent memory fallback).
    if (isProduction && apexMode) {
      for (const key of PRODUCTION_KV_ENV_VARS) {
        if (!process.env[key]?.trim()) missing.push(key);
      }
      warnings.push(
        'Apex production requires Vercel KV (KV_REST_API_URL + KV_REST_API_TOKEN). Connect Storage → KV and redeploy — rate limits fail closed without it.'
      );
    } else if (isProduction) {
      warnings.push(
        'KV_REST_API_URL + KV_REST_API_TOKEN recommended in production — without Vercel KV/Upstash, rate limits fall back to per-instance memory. Connect a KV store in Vercel → Storage → KV.'
      );
    } else {
      warnings.push(
        'KV_REST_API_URL/KV_REST_API_TOKEN not configured — distributed rate limiting disabled (in-memory fallback OK for local/dev)'
      );
    }
  } else {
    if (kvUrl && !/^https:\/\//i.test(kvUrl)) {
      warnings.push('KV_REST_API_URL should be an https:// Upstash/Vercel KV REST endpoint');
    }
    if (kvToken && kvToken.length < 16) {
      warnings.push('KV_REST_API_TOKEN looks too short — verify the REST token from the Vercel KV dashboard');
    }
  }

  const forbiddenPublicKeys = getExposedPublicGrokEnvKeys();

  if (isProduction && isTruthyEnv(process.env.ALLOW_BOOTSTRAP)) {
    warnings.push(
      'ALLOW_BOOTSTRAP is set in production but bootstrap seed is permanently disabled — remove this variable'
    );
  }

  // Product modules (Video MPI, Maintenance, Parts/Sales/Service, Loaner, Voice) — env hygiene.
  const moduleEnv = validateProductModuleEnvironment({ production: isProduction });
  for (const fail of moduleEnv.hardFails) {
    missing.push(`module_env: ${fail}`);
  }
  for (const w of moduleEnv.warnings) {
    warnings.push(w);
  }

  // APEX NATIONAL PLATFORM — Supabase is optional in Phase 1; warn on partial configuration.
  const supabase = getSupabaseEnvConfig();
  if (supabase.url && !supabase.anonKey) {
    warnings.push('NEXT_PUBLIC_SUPABASE_URL is set without NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (supabase.url && !supabase.serviceRoleKey) {
    warnings.push('NEXT_PUBLIC_SUPABASE_URL is set without SUPABASE_SERVICE_ROLE_KEY (server admin client disabled)');
  }
  if (!supabase.url && (supabase.anonKey || supabase.serviceRoleKey)) {
    warnings.push('Supabase keys are set without NEXT_PUBLIC_SUPABASE_URL');
  }
  if (supabase.isServiceConfigured && !supabase.isPostgresConfigured) {
    warnings.push(
      'Supabase API is configured but Postgres connection is missing (SUPABASE_DATABASE_URL or SUPABASE_DB_PASSWORD)'
    );
  }
  if (isProduction && supabase.url && supabase.serviceRoleKey && !isApexSupabaseProductionReady()) {
    warnings.push(
      'Apex Supabase production deployment incomplete — add Postgres connection vars from Supabase dashboard'
    );
  }

  const valid = missing.length === 0 && forbiddenPublicKeys.length === 0;

  if (forbiddenPublicKeys.length > 0) {
    const message = `Forbidden public xAI API keys detected: ${forbiddenPublicKeys.join(', ')}. Delete them from Vercel and use server-only GROK_API_KEY.`;
    logger.error('env.validation_forbidden_public_keys', { forbiddenPublicKeys });
    if (options.throwOnError) {
      throw new Error(message);
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error('env.validation_failed', { missing });
    if (options.throwOnError) {
      throw new Error(message);
    }
  }

  for (const warning of warnings) {
    logger.warn('env.validation_warning', { warning });
  }

  return { missing, warnings, forbiddenPublicKeys, valid };
}

/** Stricter validation used by `npm run build` — fails on missing required vars. */
export function validateBuildEnvironment(): EnvironmentValidationResult {
  return validateEnvironment({ throwOnError: true, production: true });
}

/** Snapshot of non-secret runtime configuration for health/status endpoints. */
export function getRuntimeConfig(promptVersion: string): RuntimeConfig {
  return {
    appVersion: getAppVersion(),
    promptVersion,
    buildCommit: getBuildCommit(),
    buildDate: getBuildDate(),
    maintenanceMode: isMaintenanceModeEnabled(),
    nodeEnv: process.env.NODE_ENV || 'development',
  };
}