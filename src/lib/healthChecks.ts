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
import { isAiJobsQueueConfigured } from '@/lib/queue/binding';
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

    const {
      isDualKeyRotationActive,
      getPrimaryKeyFingerprint,
      getPreviousKeyFingerprint,
    } = await import('@/lib/encryption');
    const dual = isDualKeyRotationActive();
    let rotationRunning = false;
    let rotationCompleted = false;
    let mfaStale = 0;
    let mfaSampled = 0;
    try {
      const {
        getActiveOrLatestRotation,
        probeStaleMfaCiphertext,
        getReencryptCoverageSummary,
      } = await import('@/lib/encryption/rotationService');
      const rot = await getActiveOrLatestRotation();
      rotationRunning = Boolean(rot && (rot.status === 'running' || rot.status === 'pending_env'));
      rotationCompleted = Boolean(rot && rot.status === 'completed');
      // P0-1: warn if MFA ciphertext still on previous key after / during rotation window.
      if (dual || rotationCompleted || rotationRunning) {
        const probe = await probeStaleMfaCiphertext(25);
        mfaStale = probe.stillOnPreviousKey;
        mfaSampled = probe.sampled;
      }
      // Ensure plan still lists MFA (static invariant for health detail).
      const coverage = getReencryptCoverageSummary();
      if (!coverage.includesMfa) {
        return {
          status: 'warn',
          latencyMs,
          detail: 'REENCRYPT_TABLE_PLAN missing MFA tables — do not remove PREVIOUS key',
        };
      }
    } catch {
      // rotation table may not exist yet
    }

    if (mfaStale > 0) {
      return {
        status: 'warn',
        latencyMs,
        detail: `MFA ciphertext still on previous key (stale=${mfaStale}/${mfaSampled} sampled) — re-run full re-encrypt before removing DATA_ENCRYPTION_KEY_PREVIOUS`,
      };
    }

    if (rotationRunning) {
      return {
        status: 'warn',
        latencyMs,
        detail: `PII key rotation in progress (fp ${getPrimaryKeyFingerprint()}${
          dual ? ` dual previous=${getPreviousKeyFingerprint()}` : ''
        }; MFA sample clean)`,
      };
    }
    if (dual) {
      return {
        status: 'warn',
        latencyMs,
        detail: `Dual-key active (primary=${getPrimaryKeyFingerprint()} previous=${getPreviousKeyFingerprint()}) — finish re-encrypt (incl. MFA) then remove DATA_ENCRYPTION_KEY_PREVIOUS`,
      };
    }
    return {
      status: 'ok',
      latencyMs,
      detail: `primary=${getPrimaryKeyFingerprint()} dualKey=off fullReencryptPlan=yes`,
    };
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
  const aiJobsQueue = await checkAiJobsQueueHealth(dealershipId || null);
  const mfaPolicy = checkMfaPolicyHealth(dealershipId || null);
  const bayMobile = checkBayMobileHealth();
  const voiceDepartments = checkVoiceDepartmentHealth();

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
    mfaPolicy,
    bayMobile,
    voiceDepartments,
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
    /** Durable Async AI — length, error rate, oldest job + producer binding */
    aiJobsQueue,
  };
}

/**
 * Multi-department Sophia posture — parent voice_agent + pilot departments.
 */
export function checkVoiceDepartmentHealth(): DependencyCheck {
  const voiceForced =
    process.env.MODULES_FORCE_ENABLE?.includes('voice_agent') ||
    process.env.MODULE_VOICE_ENABLED === '1' ||
    process.env.MODULE_VOICE_ENABLED === 'true';
  const hasTwilio = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() && process.env.TWILIO_AUTH_TOKEN?.trim()
  );
  let hasGrok = false;
  try {
    hasGrok = Boolean(getGrokApiKey());
  } catch {
    hasGrok = false;
  }

  if (!hasGrok) {
    return {
      status: 'warn',
      detail: 'Department voice query needs Grok key; phone needs Twilio when voice_agent is on',
    };
  }

  return {
    status: 'ok',
    detail: [
      'tabletQuery=/api/voice/[department]/query',
      'departments=service,loaner,parts,sales',
      'pilotDefaults=service+loaner',
      'tailoring=DepartmentCustomization',
      hasTwilio ? 'twilio=configured' : 'twilio=optional-for-tablet',
      voiceForced ? 'voice_agent=force_env' : 'voice_agent=entitlement',
    ].join('; '),
  };
}

/**
 * Shop-floor tablet / cold-start posture (ops visibility).
 * Client keep-alive + session warmup routes are the runtime signal; this is config posture.
 */
export function checkBayMobileHealth(): DependencyCheck {
  const accessTtl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 15 * 60;
  const shortSession = accessTtl > 0 && accessTtl <= 60 * 60;
  return {
    status: 'ok',
    detail: [
      'sessionWarmup=/api/session/warmup',
      'bayKeepAlive=client',
      `accessTtl=${accessTtl}s`,
      shortSession ? 'shortAccessToken=yes' : 'shortAccessToken=no',
      'roListCache=sessionStorage-swr',
      'videoMpiOfflineQueue=indexeddb',
      'controlCenterLive=/api/manager/center/live',
    ].join('; '),
  };
}

/**
 * MFA fortress status — enforcement flag + elevated-role enrollment (when rooftop known).
 */
export function checkMfaPolicyHealth(dealershipId?: string | null): DependencyCheck {
  const enforce =
    process.env.MERLIN_MFA_ENFORCE?.trim().toLowerCase() === 'true' ||
    process.env.MERLIN_MFA_ENFORCE?.trim() === '1';
  const roles = process.env.MERLIN_MFA_REQUIRED_ROLES?.trim() || 'manager,owner,admin';

  if (!enforce) {
    return {
      status: isProductionEnv() ? 'warn' : 'ok',
      detail: isProductionEnv()
        ? `MFA optional (pilot) — set MERLIN_MFA_ENFORCE=true for managers/owners; roles=${roles}`
        : `MFA optional (dev) — roles when enforced: ${roles}`,
    };
  }

  return {
    status: 'ok',
    detail: `MFA enforced for roles: ${roles}${
      dealershipId ? `; rooftop=${dealershipId.slice(0, 8)}…` : ''
    }`,
  };
}

/**
 * P0-4 — AI queue health thresholds (first-class production signal).
 * Inline fallback may still run jobs, but operators must see degraded/critical state.
 */
export const AI_QUEUE_HEALTH_THRESHOLDS = {
  /** Depth (queued+running) → warn */
  warnDepth: 50,
  /** Depth → error (critical) */
  criticalDepth: 200,
  /** 24h terminal failure ratio → warn */
  warnErrorRate: 0.25,
  /** 24h failure ratio → error */
  criticalErrorRate: 0.5,
  /** Oldest queued age → warn */
  warnOldestAgeMs: 15 * 60_000,
  /** Oldest queued age → error (consumer stall / unreachable) */
  criticalOldestAgeMs: 45 * 60_000,
} as const;

export type AiJobsQueueHealthEvalInput = {
  queueConfigured: boolean;
  production: boolean;
  depth: number;
  queued: number;
  running: number;
  errorRate24h: number;
  oldestAgeMs: number;
  isolateEnqueued: number;
  isolateCompleted: number;
  isolateFailed: number;
  /** When D1/stats probe throws */
  probeFailed?: boolean;
  probeErrorMessage?: string;
};

/**
 * Pure evaluator for unit tests + checkAiJobsQueueHealth.
 * Returns status, compact detail, and operator-facing guidance.
 */
export function evaluateAiJobsQueueHealth(input: AiJobsQueueHealthEvalInput): {
  status: DependencyStatus;
  detail: string;
  operatorGuidance: string;
  reasons: string[];
} {
  const T = AI_QUEUE_HEALTH_THRESHOLDS;
  const reasons: string[] = [];
  let status: DependencyStatus = 'ok';

  const escalate = (next: DependencyStatus) => {
    if (next === 'error') status = 'error';
    else if (next === 'warn' && status === 'ok') status = 'warn';
  };

  if (input.probeFailed) {
    // Cannot measure queue — critical when producer is bound (expect working consumer path)
    if (input.queueConfigured || input.production) {
      escalate('error');
      reasons.push('queue_probe_failed');
    } else {
      escalate('warn');
      reasons.push('queue_probe_failed_dev');
    }
  }

  if (!input.queueConfigured) {
    if (input.production) {
      escalate('error');
      reasons.push('producer_unbound_production');
    } else {
      // Dev may use inline-only path
      escalate('warn');
      reasons.push('producer_unbound_dev');
    }
  }

  if (input.depth >= T.criticalDepth) {
    escalate('error');
    reasons.push(`backlog_critical_depth=${input.depth}`);
  } else if (input.depth >= T.warnDepth) {
    escalate('warn');
    reasons.push(`backlog_elevated_depth=${input.depth}`);
  }

  if (input.errorRate24h >= T.criticalErrorRate) {
    escalate('error');
    reasons.push(`error_rate_critical=${(input.errorRate24h * 100).toFixed(0)}%`);
  } else if (input.errorRate24h >= T.warnErrorRate) {
    escalate('warn');
    reasons.push(`error_rate_elevated=${(input.errorRate24h * 100).toFixed(0)}%`);
  }

  if (input.oldestAgeMs >= T.criticalOldestAgeMs) {
    escalate('error');
    reasons.push(`oldest_queued_stale_critical`);
  } else if (input.oldestAgeMs >= T.warnOldestAgeMs) {
    escalate('warn');
    reasons.push(`oldest_queued_stale`);
  }

  const oldestMin =
    input.oldestAgeMs > 0 ? Math.round(input.oldestAgeMs / 60_000) : 0;
  const bindingNote = input.queueConfigured
    ? 'producer bound'
    : input.production
      ? 'producer unbound (inline fallback only — CRITICAL in production)'
      : 'producer unbound (dev inline fallback)';

  const detail = input.probeFailed
    ? [
        'queue health probe failed',
        input.probeErrorMessage || 'unknown',
        bindingNote,
        `binding=${input.queueConfigured ? 'yes' : 'no'}`,
      ].join('; ')
    : [
        bindingNote,
        `depth=${input.depth} (queued=${input.queued} running=${input.running})`,
        `errorRate24h=${(input.errorRate24h * 100).toFixed(1)}%`,
        input.oldestAgeMs > 0 ? `oldestQueued=${oldestMin}m` : 'oldestQueued=none',
        `isolateMetrics enq=${input.isolateEnqueued} ok=${input.isolateCompleted} fail=${input.isolateFailed}`,
        reasons.length ? `reasons=${reasons.join(',')}` : 'reasons=none',
      ].join('; ');

  let operatorGuidance = 'AI queue healthy. Durable jobs + optional inline fallback available.';
  if (status === 'error') {
    if (reasons.includes('producer_unbound_production')) {
      operatorGuidance =
        'CRITICAL: CF Queue producer unbound. Jobs use inline fallback only — bind AI_JOBS queue + consumer Worker (APP_BASE_URL, AI_QUEUE_CONSUMER_SECRET), redeploy. Bay AI may slow under load.';
    } else if (reasons.some((r) => r.startsWith('oldest_queued') || r.includes('backlog_critical'))) {
      operatorGuidance =
        'CRITICAL: AI job backlog / consumer stall. Check merlinus-ai-jobs consumer Worker, DLQ, D1 write latency. Inline fallback may still serve some bay requests but warranty story latency will rise. Page on-call if oldest job > 45m or depth ≥ 200.';
    } else if (reasons.some((r) => r.startsWith('error_rate_critical'))) {
      operatorGuidance =
        'CRITICAL: AI job failure rate ≥ 50% (24h). Inspect Grok keys, job errors in Manager → AI Jobs, and consumer logs. Retry failed jobs after fix.';
    } else if (reasons.includes('queue_probe_failed')) {
      operatorGuidance =
        'CRITICAL: Cannot read AI job queue from D1. Database/RLS or AiJob table issue — verify D1 binding and migrations. Do not ignore green bay UX; async path may be broken.';
    } else {
      operatorGuidance =
        'CRITICAL: AI jobs queue unhealthy. Open Manager Control Center → AI Jobs + Health. Fallback may mask symptoms — restore queue before multi-rooftop peak.';
    }
  } else if (status === 'warn') {
    if (reasons.includes('producer_unbound_dev')) {
      operatorGuidance =
        'Queue producer unbound (dev). Inline path OK for local; bind CF Queues before production traffic.';
    } else {
      operatorGuidance =
        'AI queue elevated (depth, age, or error rate). Monitor Manager → AI Jobs. Confirm consumer Worker is processing; expect slower stories if backlog grows. Fallback still available for some paths.';
    }
  }

  return { status, detail, operatorGuidance, reasons };
}

/**
 * Queue health: CF producer binding + D1 job depth / 24h error rate / oldest queued age.
 * P0-4: critical (error) for unbound prod, high error rate, severe backlog/age, probe failure.
 */
export async function checkAiJobsQueueHealth(
  dealershipId?: string | null
): Promise<DependencyCheck> {
  const queueConfigured = isAiJobsQueueConfigured();
  const production = isProductionEnv();
  const start = Date.now();

  try {
    const { getDealershipJobHealthStats, getGlobalAiJobQueueHealth } = await import(
      '@/lib/aiJobs/service'
    );
    const { getQueueErrorRate, getQueueMetricsSnapshot } = await import('@/lib/queue/metrics');

    const stats = dealershipId?.trim()
      ? await getDealershipJobHealthStats(dealershipId.trim())
      : await getGlobalAiJobQueueHealth();
    const metrics = getQueueMetricsSnapshot();
    const isolateErrorRate = getQueueErrorRate();
    const latencyMs = Date.now() - start;

    const depth = stats.queueDepth;
    const errorRate = Math.max(stats.errorRate24h, isolateErrorRate);
    const oldestAgeMs = stats.oldestQueuedAgeMs ?? 0;

    const evaluated = evaluateAiJobsQueueHealth({
      queueConfigured,
      production,
      depth,
      queued: stats.queued,
      running: stats.running,
      errorRate24h: errorRate,
      oldestAgeMs,
      isolateEnqueued: metrics.enqueued,
      isolateCompleted: metrics.completed,
      isolateFailed: metrics.failed,
    });

    return {
      status: evaluated.status,
      latencyMs,
      detail: `${evaluated.detail} | ops: ${evaluated.operatorGuidance}`,
    };
  } catch (error) {
    const latencyMs = Date.now() - start;
    const evaluated = evaluateAiJobsQueueHealth({
      queueConfigured,
      production,
      depth: 0,
      queued: 0,
      running: 0,
      errorRate24h: 0,
      oldestAgeMs: 0,
      isolateEnqueued: 0,
      isolateCompleted: 0,
      isolateFailed: 0,
      probeFailed: true,
      probeErrorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      status: evaluated.status,
      latencyMs,
      detail: `${evaluated.detail} | ops: ${evaluated.operatorGuidance}`,
    };
  }
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
  // aiJobsQueue: P0-4 first-class — unbound / severe backlog / high fail rate / probe fail.
  return isProductionEnv()
    ? ['database', 'kv', 'ownerSeedSecrets', 'aiJobsQueue']
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