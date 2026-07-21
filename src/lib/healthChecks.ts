import { VOICE_INPUT_SETTINGS } from './constants';
import { isObjectStorageConfigured, probeObjectStorage } from '@/lib/storage/objectStorage';
import { isMaintenanceModeEnabled, validateEnvironment } from './env';
import { getExposedPublicGrokEnvKeys, getGrokApiKey } from './grokApiKey.shared';
import { encryptPII, decryptPII } from './encryption';
import 'server-only';

import { prisma, probeDatabaseConnection } from './db';
import { getDatabaseBackendSummary } from '@/lib/apex/databaseConfig';
import { evaluateOwnerSeedSecretPolicy } from '@/lib/apex/ownerSeedSecurity';
import { getCdkLiveSyncStatus } from '@/lib/cdk/status';
import { describeTenantIsolation } from '@/lib/tenantIsolation';
import { getVoiceRealtimeStatus } from '@/lib/voiceAgent/realtimeConfig';
import { isCiOrTestRuntime, isKvConfigured, isProductionEnv } from './rate-limit';
import { logger } from './logger';
import { isApexSupabaseProductionReady } from '@/lib/supabaseEnv';
import { probeSupabaseConnection } from '@/lib/supabase';

/** Lightweight Grok reachability probe — models list only (no token spend). */
const GROK_MODELS_URL = 'https://api.x.ai/v1/models';
const GROK_CONNECTIVITY_TIMEOUT_MS = 8_000;

export type DependencyStatus = 'ok' | 'warn' | 'error';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs?: number;
  /** Internal diagnostics — never returned from /api/health (logged server-side only). */
  detail?: string;
}

export interface HealthServiceStatus {
  status: DependencyStatus;
  latencyMs?: number;
}

export function toHealthServiceStatus(check: DependencyCheck): HealthServiceStatus {
  return check.latencyMs !== undefined
    ? { status: check.status, latencyMs: check.latencyMs }
    : { status: check.status };
}

export function buildHealthServicesPayload(
  checks: Record<string, DependencyCheck>
): Record<string, HealthServiceStatus> {
  return Object.fromEntries(
    Object.entries(checks).map(([name, check]) => [name, toHealthServiceStatus(check)])
  );
}

export function logUnhealthyServices(checks: Record<string, DependencyCheck>): void {
  for (const [name, check] of Object.entries(checks)) {
    if (check.status === 'error' || check.status === 'warn') {
      logger.warn('health.service_check', {
        service: name,
        status: check.status,
        latencyMs: check.latencyMs,
        detail: check.detail,
      });
    }
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, latencyMs: Date.now() - start };
}

export function checkEnvironmentConfig(): DependencyCheck {
  try {
    const { missing, warnings } = validateEnvironment({ throwOnError: false });
    if (missing.length > 0) {
      return {
        status: 'error',
        detail: `Missing required env: ${missing.join(', ')}`,
      };
    }
    if (warnings.length > 0) {
      return {
        status: 'warn',
        detail: warnings.join('; '),
      };
    }
    return { status: 'ok' };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'environment validation failed',
    };
  }
}

export async function checkDatabase(): Promise<DependencyCheck> {
  try {
    const { latencyMs } = await timed(async () => {
      await probeDatabaseConnection();
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'connection failed',
    };
  }
}

export async function checkEncryption(): Promise<DependencyCheck> {
  const key = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!key || key.length < 32) {
    return { status: 'error', detail: 'DATA_ENCRYPTION_KEY missing or too short (min 32 chars)' };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const sample = 'health-check-pii-roundtrip';
      const encrypted = encryptPII(sample);
      const decrypted = decryptPII(encrypted);
      if (decrypted !== sample) {
        throw new Error('encrypt/decrypt roundtrip mismatch');
      }
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'encryption check failed',
    };
  }
}

export async function checkSessionSecret(): Promise<DependencyCheck> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    return { status: 'error', detail: 'SESSION_SECRET not configured' };
  }
  if (secret.length < 32) {
    return { status: 'warn', detail: 'SESSION_SECRET shorter than recommended 32 characters' };
  }
  return { status: 'ok' };
}

export async function checkBlobStorage(): Promise<DependencyCheck> {
  if (!isObjectStorageConfigured()) {
    const detail =
      'Cloudflare R2 binding APEX_R2 not available — RO and Xentry photo scanning disabled';
    return isProductionEnv()
      ? { status: 'error', detail }
      : { status: 'warn', detail };
  }
  try {
    const { latencyMs } = await timed(async () => {
      await probeObjectStorage();
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'object storage (R2) unreachable',
    };
  }
}

/** Validates Grok API key configuration (no network call). */
export async function checkGrokApi(): Promise<DependencyCheck> {
  const exposedPublicKeys = getExposedPublicGrokEnvKeys();
  if (exposedPublicKeys.length > 0) {
    return {
      status: 'error',
      detail: 'Frontend xAI env vars detected — use server-only GROK_API_KEY',
    };
  }

  try {
    getGrokApiKey();
    return { status: 'ok', detail: 'GROK_API_KEY configured' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GROK_API_KEY not configured';
    if (message.includes('not configured')) {
      const detail = 'GROK_API_KEY not configured — RO and Xentry photo scanning disabled';
      return isProductionEnv()
        ? { status: 'error', detail }
        : { status: 'warn', detail };
    }
    return { status: 'error', detail: 'Grok API key configuration invalid' };
  }
}

/** Live Grok API connectivity via models list (no completion tokens consumed). */
export async function checkGrokApiConnectivity(): Promise<DependencyCheck> {
  if (isCiOrTestRuntime() || !isProductionEnv()) {
    return checkGrokApi();
  }

  const exposedPublicKeys = getExposedPublicGrokEnvKeys();
  if (exposedPublicKeys.length > 0) {
    return {
      status: 'error',
      detail: 'Frontend xAI env vars detected — use server-only GROK_API_KEY',
    };
  }

  let apiKey: string;
  try {
    apiKey = getGrokApiKey();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GROK_API_KEY not configured';
    if (message.includes('not configured')) {
      return { status: 'warn', detail: 'GROK_API_KEY not configured — connectivity probe skipped' };
    }
    return { status: 'error', detail: 'Grok API key configuration invalid' };
  }

  try {
    const { latencyMs } = await timed(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GROK_CONNECTIVITY_TIMEOUT_MS);
      try {
        const response = await fetch(GROK_MODELS_URL, {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Grok API returned HTTP ${response.status}`);
        }
        return true;
      } finally {
        clearTimeout(timer);
      }
    });
    return { status: 'ok', latencyMs, detail: 'Grok API reachable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Grok API unreachable';
    if (message.toLowerCase().includes('abort')) {
      return { status: 'warn', detail: 'Grok API connectivity probe timed out' };
    }
    return { status: 'warn', detail: message };
  }
}

export async function checkAdvisorIntelligence(): Promise<DependencyCheck> {
  try {
    const { latencyMs } = await timed(async () => {
      await prisma.serviceAdvisor.count();
      await prisma.advisorWritingProfile.count();
      return true;
    });
    return { status: 'ok', latencyMs, detail: 'Advisor Intelligence schema ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'schema check failed';
    if (/does not exist|relation .* not found/i.test(message)) {
      return {
        status: 'error',
        detail: 'Advisor Intelligence migration not applied — run: npx prisma migrate deploy',
      };
    }
    return { status: 'error', detail: message };
  }
}

export async function checkKvStore(): Promise<DependencyCheck> {
  if (isCiOrTestRuntime()) {
    if (!isKvConfigured()) {
      return {
        status: 'warn',
        detail: 'KV_REST_API_URL/TOKEN not configured — test/CI uses in-memory rate limit fallback',
      };
    }
    return {
      status: 'warn',
      detail: 'KV live probe skipped in test/CI — credentials are not exercised in health checks',
    };
  }

  if (!isKvConfigured()) {
    return isProductionEnv()
      ? {
          status: 'warn',
          detail:
            'KV_REST_API_URL/TOKEN not configured — production uses in-memory rate limit fallback',
        }
      : {
          status: 'warn',
          detail: 'KV_REST_API_URL/TOKEN not configured — dev uses in-memory rate limit fallback',
        };
  }
  try {
    const { latencyMs } = await timed(async () => {
      const { kv } = await import('@vercel/kv');
      const probeKey = `health:probe:${Date.now()}`;
      await kv.set(probeKey, '1', { ex: 15 });
      const value = await kv.get(probeKey);
      if (value !== '1') {
        throw new Error('KV read/write probe failed');
      }
      await kv.del(probeKey);
      return true;
    });
    return { status: 'ok', latencyMs };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'KV store unreachable';
    return {
      status: 'warn',
      detail: `KV store unreachable — using in-memory rate limit fallback: ${detail}`,
    };
  }
}

/** M20: validate voice config + Web Speech API browser requirement (client-side API). */
export function checkVoiceInput(): DependencyCheck {
  if (!VOICE_INPUT_SETTINGS.enabled) {
    return { status: 'warn', detail: 'Voice input disabled in dealership configuration' };
  }
  const lang = VOICE_INPUT_SETTINGS.language;
  const langValid = /^[a-z]{2}(-[A-Z]{2})?$/.test(lang);
  const timeoutMs = VOICE_INPUT_SETTINGS.listeningTimeoutMs;
  const timeoutOk = timeoutMs === 0 || timeoutMs >= 600_000;
  const issues: string[] = [];
  if (!langValid) issues.push(`invalid language tag "${lang}"`);
  if (!timeoutOk) issues.push(`listening timeout ${timeoutMs}ms too low for long dictation`);
  if (issues.length > 0) {
    return { status: 'error', detail: `Voice config invalid: ${issues.join('; ')}` };
  }
  const timeoutLabel = timeoutMs === 0 ? 'no inactivity cutoff' : `${timeoutMs}ms timeout`;
  return {
    status: 'ok',
    detail: `Voice ready (${lang}, ${timeoutLabel}). Requires Chrome/Edge Web Speech API on shop tablets.`,
  };
}

export function checkMaintenanceMode(): DependencyCheck {
  if (isMaintenanceModeEnabled()) {
    return { status: 'warn', detail: 'MERLIN_MAINTENANCE_MODE active — AI routes blocked' };
  }
  return { status: 'ok', detail: 'Normal operation' };
}

/**
 * P0 — Owner seed passwords must not remain on production Workers after bootstrap.
 * FAIL (error) in production when OWNER_SEED_PASSWORD* present without ALLOW_OWNER_SEED_BOOTSTRAP.
 * WARN during one-shot bootstrap window. OK when secrets absent.
 */
export function checkOwnerSeedSecrets(): DependencyCheck {
  const policy = evaluateOwnerSeedSecretPolicy();

  if (policy.violation) {
    return {
      status: 'error',
      detail: policy.message,
    };
  }

  if (policy.production && policy.presentPasswordKeys.length > 0 && policy.bootstrapAllowed) {
    return {
      status: 'warn',
      detail: policy.message,
    };
  }

  if (!policy.production && policy.presentPasswordKeys.length > 0) {
    return {
      status: 'ok',
      detail: `Dev/test owner seed passwords present (${policy.presentPasswordKeys.join(', ')})`,
    };
  }

  return {
    status: 'ok',
    detail: 'No owner seed password secrets in environment',
  };
}

/** APEX NATIONAL PLATFORM — optional Supabase API probe (warn when partially configured). */
export async function checkSupabase(): Promise<DependencyCheck> {
  const backend = getDatabaseBackendSummary();
  if (!isApexSupabaseProductionReady()) {
    return { status: 'ok', detail: 'Supabase not configured (Merlinus legacy mode)' };
  }

  const probe = await probeSupabaseConnection('service');
  if (!probe.ok) {
    return {
      status: 'warn',
      latencyMs: probe.latencyMs,
      detail: probe.detail || 'Supabase API probe failed',
    };
  }

  return {
    status: 'ok',
    latencyMs: probe.latencyMs,
    detail: `Apex Supabase connected (${backend.supabaseProjectRef ?? 'project'})`,
  };
}

export async function runAllHealthChecks(): Promise<Record<string, DependencyCheck>> {
  const environment = checkEnvironmentConfig();
  const voice = checkVoiceInput();
  const maintenance = checkMaintenanceMode();
  const ownerSeedSecrets = checkOwnerSeedSecrets();
  const [database, encryption, session, blob, grok, kv, advisorIntelligence, supabase] = await Promise.all([
    checkDatabase(),
    checkEncryption(),
    checkSessionSecret(),
    checkBlobStorage(),
    checkGrokApi(),
    checkKvStore(),
    checkAdvisorIntelligence(),
    checkSupabase(),
  ]);

  return {
    environment,
    database,
    encryption,
    session,
    blob,
    grok,
    kv,
    voice,
    maintenance,
    ownerSeedSecrets,
    advisorIntelligence,
    supabase,
  };
}

/** Twilio voice credentials (SID + auth token) — required when voice_agent is enabled. */
export function checkTwilioVoiceConfig(options?: {
  voiceAgentEnabled?: boolean;
}): DependencyCheck {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const skipSig =
    process.env.VOICE_TWILIO_SKIP_SIGNATURE?.trim().toLowerCase() === 'true' ||
    process.env.VOICE_TWILIO_SKIP_SIGNATURE?.trim() === '1';

  if (skipSig && isProductionEnv()) {
    return {
      status: 'error',
      detail: 'VOICE_TWILIO_SKIP_SIGNATURE must not be enabled in production',
    };
  }

  if (sid && token) {
    return {
      status: skipSig ? 'warn' : 'ok',
      detail: skipSig
        ? 'Twilio voice credentials set but signature verification skipped (dev only)'
        : 'Twilio voice credentials configured',
    };
  }

  if (options?.voiceAgentEnabled) {
    return {
      status: 'error',
      detail:
        'voice_agent is enabled for this rooftop but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are missing',
    };
  }

  return {
    status: 'ok',
    detail: 'Twilio voice not required (voice_agent off or not scoped)',
  };
}

/** SMS for Video MPI customer links — only required when SMS_ENABLED and video_mpi on. */
export function checkTwilioSmsConfig(options?: {
  videoMpiEnabled?: boolean;
}): DependencyCheck {
  const smsFlag = process.env.SMS_ENABLED?.trim().toLowerCase();
  const smsOn = smsFlag === '1' || smsFlag === 'true' || smsFlag === 'yes';
  if (!smsOn) {
    return {
      status: 'ok',
      detail: 'SMS_ENABLED is off — customer SMS delivery disabled',
    };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (sid && token && from) {
    return { status: 'ok', detail: 'Twilio SMS credentials configured' };
  }

  if (options?.videoMpiEnabled || isProductionEnv()) {
    return {
      status: 'error',
      detail:
        'SMS_ENABLED is true but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are incomplete',
    };
  }

  return {
    status: 'warn',
    detail: 'SMS_ENABLED but Twilio SMS credentials incomplete',
  };
}

export interface ModuleHealthSummary {
  moduleId: string;
  enabled: boolean;
  source: string;
}

/**
 * Resolve enabled product modules for a rooftop (manager health module matrix).
 */
export async function resolveModuleHealthSummary(
  dealershipId: string | null | undefined
): Promise<ModuleHealthSummary[]> {
  const id = dealershipId?.trim() || '';
  if (!id) return [];

try {
    const { listModuleStatuses } = await import('@/lib/modules/entitlements');
    const statuses = await listModuleStatuses(id);
    return statuses.map((s) => ({
      moduleId: s.moduleId,
      enabled: s.enabled,
      source: s.source,
    }));
  } catch {
    return [];
  }
}

export interface AuthenticatedHealthOptions {
  /** Active rooftop — enables module-aware Twilio / SKU summary. */
  dealershipId?: string | null;
}

/**
 * Manager-authenticated enterprise health matrix.
 * P0-3: includes R2, owner seed secrets, and module-aware Twilio when rooftop known.
 * Error details are logged server-side only; API returns status + latency per service.
 */
export async function runAuthenticatedHealthChecks(
  options: AuthenticatedHealthOptions = {}
): Promise<Record<string, DependencyCheck>> {
  const voice = checkVoiceInput();
  const maintenance = checkMaintenanceMode();
  const ownerSeedSecrets = checkOwnerSeedSecrets();

  let voiceAgentEnabled = false;
  let videoMpiEnabled = false;
  const dealershipId = options.dealershipId?.trim() || '';
  if (dealershipId) {
    try {
      const { isModuleEnabled } = await import('@/lib/modules/entitlements');
      voiceAgentEnabled = await isModuleEnabled(dealershipId, 'voice_agent');
      videoMpiEnabled = await isModuleEnabled(dealershipId, 'video_mpi');
    } catch {
      // module probe optional
    }
  }

  const twilioVoice = checkTwilioVoiceConfig({ voiceAgentEnabled });
  const twilioSms = checkTwilioSmsConfig({ videoMpiEnabled });

  const [database, encryption, kv, grokConfig, grok, objectStorage] = await Promise.all([
    checkDatabase(),
    checkEncryption(),
    checkKvStore(),
    checkGrokApi(),
    checkGrokApiConnectivity(),
    checkBlobStorage(),
  ]);

  const tenantIsolation = describeTenantIsolation();
  const cdk = getCdkLiveSyncStatus();
  const voiceRealtime = getVoiceRealtimeStatus();

  return {
    database,
    encryption,
    kv,
    grokConfig,
    grok,
    objectStorage,
    twilioVoice,
    twilioSms,
    voice,
    maintenance,
    ownerSeedSecrets,
    // Informational (never critical) — ops visibility for P3 roadmap items
    tenantIsolation: {
      status: tenantIsolation.databaseEnforced ? 'ok' : 'ok',
      detail: `${tenantIsolation.mode}; databaseEnforced=${tenantIsolation.databaseEnforced}`,
    } satisfies DependencyCheck,
    cdkLiveSync: {
      status: cdk.available ? 'ok' : 'ok',
      detail: cdk.reason,
    } satisfies DependencyCheck,
    voiceRealtime: {
      status: voiceRealtime.premiumEnabled ? 'warn' : 'ok',
      detail: voiceRealtime.message,
    } satisfies DependencyCheck,
  };
}

export function aggregateHealthStatus(
  checks: Record<string, DependencyCheck>
): 'ok' | 'degraded' | 'error' {
  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'warn')) return 'degraded';
  return 'ok';
}

/** Critical deps that map to HTTP 503 on manager /api/health. */
export function getCriticalHealthServices(): string[] {
  // ownerSeedSecrets: production must not keep OWNER_SEED_PASSWORD* on the Worker.
  return isProductionEnv()
    ? ['database', 'kv', 'ownerSeedSecrets']
    : ['database'];
}

/** Manager /api/health — 503 only when a critical dependency fails. */
export function aggregateAuthenticatedHealthStatus(
  checks: Record<string, DependencyCheck>
): 'ok' | 'degraded' | 'error' {
  for (const name of getCriticalHealthServices()) {
    if (checks[name]?.status === 'error') {
      return 'error';
    }
  }

  const statuses = Object.values(checks).map((c) => c.status);
  if (statuses.some((s) => s === 'error' || s === 'warn')) {
    return 'degraded';
  }
  return 'ok';
}

/** HTTP status for manager /api/health — always 200 unless a critical dependency failed. */
export function resolveAuthenticatedHealthHttpStatus(
  checks: Record<string, DependencyCheck>
): number {
  for (const name of getCriticalHealthServices()) {
    if (checks[name]?.status === 'error') {
      return 503;
    }
  }
  return 200;
}