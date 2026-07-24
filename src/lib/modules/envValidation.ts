/**
 * Product-module environment validation helpers (PR hardening).
 * Pure — safe for unit tests and shared with scripts via mirrored checks in validate-env.mjs.
 *
 * core_story is never validated as a module id.
 */

import {
  isProductModuleId,
  MODULE_ENV_ALIASES,
  PRODUCT_MODULE_IDS,
  type ProductModuleId,
} from '@/lib/modules/catalog';

export interface ModuleEnvValidationResult {
  /** Production hard failures (must block deploy). */
  hardFails: string[];
  warnings: string[];
  /** Invalid tokens in MODULES_FORCE_ENABLE. */
  invalidForceIds: string[];
  forcedModules: ProductModuleId[];
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes';
}

/**
 * Parse MODULES_FORCE_ENABLE; collect unknown tokens (including core_story).
 */
export function parseModulesForceEnableDetailed(
  envValue = process.env.MODULES_FORCE_ENABLE
): { forced: ProductModuleId[]; invalid: string[] } {
  const forced: ProductModuleId[] = [];
  const invalid: string[] = [];
  if (!envValue?.trim()) return { forced, invalid };
  for (const raw of envValue.split(',')) {
    const id = raw.trim();
    if (!id) continue;
    if (isProductModuleId(id)) forced.push(id);
    else if (MODULE_ENV_ALIASES[id]) forced.push(MODULE_ENV_ALIASES[id]!);
    else invalid.push(id);
  }
  return { forced, invalid };
}

/**
 * Validate module-related environment for local or production.
 */
export function validateProductModuleEnvironment(options?: {
  production?: boolean;
  env?: NodeJS.ProcessEnv;
}): ModuleEnvValidationResult {
  const env = options?.env ?? process.env;
  const isProduction =
    options?.production ??
    (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production');

  const hardFails: string[] = [];
  const warnings: string[] = [];

  const { forced, invalid } = parseModulesForceEnableDetailed(env.MODULES_FORCE_ENABLE);
  if (invalid.length > 0) {
    const msg = `MODULES_FORCE_ENABLE contains unknown module id(s): ${invalid.join(', ')} (valid: ${PRODUCT_MODULE_IDS.join(', ')})`;
    if (isProduction) hardFails.push(msg);
    else warnings.push(msg);
  }
  if (forced.length > 0 && isProduction) {
    warnings.push(
      `MODULES_FORCE_ENABLE is set in production (${forced.join(', ')}) — prefer rooftop Module toggles; force is break-glass only`
    );
  }

  // Voice agent Twilio signature skip must never ship to production.
  if (isTruthy(env.VOICE_TWILIO_SKIP_SIGNATURE)) {
    const msg =
      'VOICE_TWILIO_SKIP_SIGNATURE is enabled — Twilio webhook signatures are not verified (local tunnel only)';
    if (isProduction) hardFails.push(msg);
    else warnings.push(msg);
  }

  // Voice agent telephony credentials — required only when force-enabled or SMS path is on.
  const voiceForced = forced.includes('voice_agent');
  const twilioSid = env.TWILIO_ACCOUNT_SID?.trim();
  const twilioToken = env.TWILIO_AUTH_TOKEN?.trim();
  const twilioFrom = env.TWILIO_FROM_NUMBER?.trim();
  const twilioComplete = Boolean(twilioSid && twilioToken);

  if (voiceForced && !twilioComplete) {
    const msg =
      'voice_agent is force-enabled but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are incomplete — inbound voice will fail';
    if (isProduction) hardFails.push(msg);
    else warnings.push(msg);
  } else if (!twilioComplete) {
    warnings.push(
      'Twilio voice credentials not fully set (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN) — AI Voice Agent webhooks stay inactive until configured'
    );
  }

  if (isTruthy(env.SMS_ENABLED)) {
    if (!twilioSid || !twilioToken || !twilioFrom) {
      const msg =
        'SMS_ENABLED is true but TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER are all required for Video MPI SMS delivery';
      if (isProduction) hardFails.push(msg);
      else warnings.push(msg);
    }
  }

  // Media: Cloudflare R2 (APEX_R2). Legacy Vercel Blob token is optional/unused on Workers.
  if (!env.BLOB_READ_WRITE_TOKEN?.trim()) {
    warnings.push(
      'BLOB_READ_WRITE_TOKEN not set (legacy) — Workers use R2 binding APEX_R2 for RO photos, Video MPI, and voice media'
    );
  }

  // Public app URL needed for Twilio callback absolute URLs.
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim() || env.APP_URL?.trim();
  if (voiceForced && !appUrl) {
    warnings.push(
      'NEXT_PUBLIC_APP_URL (or APP_URL) should be set for Twilio webhook action URLs when voice_agent is enabled'
    );
  }

  // CDK deferred — never required.
  if (forced.includes('cdk_sync')) {
    warnings.push(
      'cdk_sync is force-enabled but live CDK Global sync is not implemented yet (PR-M7) — force has no effect until credentials + client ship'
    );
  }

  return {
    hardFails,
    warnings,
    invalidForceIds: invalid,
    forcedModules: forced,
  };
}
