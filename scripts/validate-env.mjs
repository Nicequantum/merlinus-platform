#!/usr/bin/env node
/**
 * Build-time environment validation — runs before `next build`.
 * Fails fast when critical secrets are missing in CI/production pipelines.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const REQUIRED = ['DATA_ENCRYPTION_KEY', 'SEARCH_HMAC_KEY', 'SESSION_SECRET'];
/** Must never be set — exposes xAI keys to the browser bundle. Use GROK_API_KEY only. */
const FORBIDDEN_PUBLIC_GROK_KEYS = [
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
  'NEXT_PUBLIC_XAI_KEY',
];
/** Required in production — RO/Xentry scanning uploads photos to Vercel Blob before Grok vision. */
const PRODUCTION_SCANNING_REQUIRED = ['BLOB_READ_WRITE_TOKEN', 'GROK_API_KEY'];
/** Required in production — distributed rate limiting must not fall back to per-instance memory. */
const PRODUCTION_REQUIRED = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'];

function loadDotEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnvFile('.env');
loadDotEnvFile('.env.local');
loadDotEnvFile('.env.production');

const apexEnvEnabled = ['1', 'true', 'yes'].includes(process.env.APEX_ENV?.trim().toLowerCase());
if (apexEnvEnabled) {
  loadDotEnvFile('.env.apex.local');
  console.log('[merlin:build] APEX_ENV active — loaded .env.apex.local');
}

// Cloudflare D1 is the sole database — no Postgres DATABASE_URL / DIRECT_URL required.
// Prisma CLI needs a file: URL for generate only; coerce any non-file URL so CI secrets
// that still set postgresql:// do not break prisma generate.
const rawDbUrl = process.env.DATABASE_URL?.trim() || '';
if (!rawDbUrl.startsWith('file:')) {
  if (rawDbUrl && /^postgres(ql)?:\/\//i.test(rawDbUrl)) {
    console.warn(
      '[merlin:build] Ignoring PostgreSQL DATABASE_URL — Merlinus uses Cloudflare D1. Using file:./prisma/dev.db for prisma generate only.'
    );
  } else if (rawDbUrl) {
    console.warn(
      `[merlin:build] DATABASE_URL is not a sqlite file: URL — using file:./prisma/dev.db for prisma generate (was: ${rawDbUrl.slice(0, 32)}…)`
    );
  } else {
    console.log('[merlin:build] DATABASE_URL unset — using file:./prisma/dev.db for prisma generate only');
  }
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}
delete process.env.DIRECT_URL;
console.log('[merlin:build] Database: Cloudflare D1 (binding DB) / local sqlite file for generate');

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const exposedPublicGrokKeys = FORBIDDEN_PUBLIC_GROK_KEYS.filter((key) => process.env[key]?.trim());
if (exposedPublicGrokKeys.length > 0) {
  console.error(
    `[merlin:build] FORBIDDEN public xAI API keys: ${exposedPublicGrokKeys.join(', ')}`
  );
  console.error(
    '[merlin:build] Delete these from Vercel immediately. Use server-only GROK_API_KEY (no NEXT_PUBLIC_ prefix).'
  );
  process.exit(1);
}

const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`[merlin:build] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[merlin:build] Configure .env.local or your CI/CD secret store before building.');
  process.exit(1);
}

const AUTH_MODES = ['legacy', 'dual', 'clerk'];
const authModeRaw = process.env.AUTH_MODE?.trim().toLowerCase();
const authMode = authModeRaw || 'legacy';
if (authModeRaw && !AUTH_MODES.includes(authMode)) {
  console.error(
    `[merlin:build] Invalid AUTH_MODE="${process.env.AUTH_MODE}" — expected legacy, dual, or clerk`
  );
  process.exit(1);
}
const clerkKeysConfigured = Boolean(
  process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
);
if (authMode === 'clerk' && !clerkKeysConfigured) {
  console.error(
    '[merlin:build] AUTH_MODE=clerk requires CLERK_SECRET_KEY and NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'
  );
  process.exit(1);
}
if ((authMode === 'dual' || authMode === 'clerk') && !clerkKeysConfigured) {
  console.warn(
    '[merlin:build] AUTH_MODE includes Clerk but Clerk keys are missing — Clerk sign-in disabled; legacy JWT remains available.'
  );
}

const publicAuthModeRaw = process.env.NEXT_PUBLIC_AUTH_MODE?.trim().toLowerCase();
const publicAuthMode = publicAuthModeRaw || authMode;
if (publicAuthModeRaw && !AUTH_MODES.includes(publicAuthMode)) {
  console.error(
    `[merlin:build] Invalid NEXT_PUBLIC_AUTH_MODE="${process.env.NEXT_PUBLIC_AUTH_MODE}" — expected legacy, dual, or clerk`
  );
  process.exit(1);
}
if (publicAuthModeRaw && publicAuthMode !== authMode) {
  console.warn(
    `[merlin:build] NEXT_PUBLIC_AUTH_MODE (${publicAuthMode}) differs from AUTH_MODE (${authMode}) — client login UI may not match server auth.`
  );
}

if ((authMode === 'dual' || authMode === 'clerk') && clerkKeysConfigured && !process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
  console.warn(
    '[merlin:build] CLERK_WEBHOOK_SIGNING_SECRET is unset — Clerk webhooks will fail verification until configured.'
  );
}

if (isProduction) {
  const missingScanning = PRODUCTION_SCANNING_REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missingScanning.length > 0) {
    console.error(
      `[merlin:build] Missing required scanning environment variables: ${missingScanning.join(', ')}`
    );
    console.error(
      '[merlin:build] RO and Xentry scanning require Vercel Blob (BLOB_READ_WRITE_TOKEN) and Grok vision (GROK_API_KEY).'
    );
    console.error(
      '[merlin:build] Vercel: Project → Storage → Create Blob Store → connect to this project (auto-injects BLOB_READ_WRITE_TOKEN).'
    );
    process.exit(1);
  }

  if (process.env.ALLOW_BOOTSTRAP?.trim().toLowerCase() === 'true') {
    console.warn(
      '[merlin:build] ALLOW_BOOTSTRAP is set but /api/setup/seed is permanently disabled in production.'
    );
  }

  const missingProd = PRODUCTION_REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missingProd.length > 0) {
    const apex =
      process.env.PLATFORM_MODE?.trim().toLowerCase() === 'apex' ||
      process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim().toLowerCase() === 'apex' ||
      ['1', 'true', 'yes'].includes(process.env.APEX_ENV?.trim().toLowerCase() || '');
    console.error(
      `[merlin:build] Missing required production environment variables: ${missingProd.join(', ')}`
    );
    console.error(
      apex
        ? '[merlin:build] Apex production HARD-REQUIRES Vercel KV (KV_REST_API_URL + KV_REST_API_TOKEN). Rate limits fail closed without it. Vercel → Storage → Create KV → connect project.'
        : '[merlin:build] Configure Vercel KV / Upstash (KV_REST_API_URL + KV_REST_API_TOKEN) for distributed rate limiting.'
    );
    process.exit(1);
  }
} else {
  const missingScanning = PRODUCTION_SCANNING_REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missingScanning.length > 0) {
    console.warn(
      `[merlin:build] Scanning disabled until configured (optional for local builds): ${missingScanning.join(', ')}`
    );
  }
  const missingKv = PRODUCTION_REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missingKv.length > 0) {
    console.warn(
      `[merlin:build] Optional for local builds (rate limiting uses in-memory fallback): ${missingKv.join(', ')}`
    );
  }
}

function resolveCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA?.trim()) return process.env.VERCEL_GIT_COMMIT_SHA.trim();
  if (process.env.GIT_COMMIT?.trim()) return process.env.GIT_COMMIT.trim();
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

process.env.NEXT_PUBLIC_BUILD_COMMIT = resolveCommit();
process.env.NEXT_PUBLIC_BUILD_DATE = new Date().toISOString();

// ─── Product modules (Video MPI, Maintenance, Parts/Sales/Service, Loaner, Voice, CDK deferred) ───
const PRODUCT_MODULE_IDS = [
  'video_mpi',
  'maintenance',
  'voice_agent',
  'loaner',
  'parts',
  'sales',
  'service',
  'cdk_sync',
];

function parseModulesForce(envValue) {
  const forced = [];
  const invalid = [];
  if (!envValue?.trim()) return { forced, invalid };
  for (const raw of envValue.split(',')) {
    const id = raw.trim();
    if (!id) continue;
    if (PRODUCT_MODULE_IDS.includes(id)) forced.push(id);
    else invalid.push(id);
  }
  return { forced, invalid };
}

const truthy = (v) => ['1', 'true', 'yes'].includes((v || '').trim().toLowerCase());
const { forced: forcedModules, invalid: invalidForceModules } = parseModulesForce(
  process.env.MODULES_FORCE_ENABLE
);

if (invalidForceModules.length > 0) {
  const msg = `MODULES_FORCE_ENABLE has unknown id(s): ${invalidForceModules.join(', ')} (valid: ${PRODUCT_MODULE_IDS.join(', ')})`;
  if (isProduction) {
    console.error(`[merlin:build] ${msg}`);
    process.exit(1);
  }
  console.warn(`[merlin:build] ${msg}`);
}

if (forcedModules.length > 0) {
  if (isProduction) {
    console.warn(
      `[merlin:build] MODULES_FORCE_ENABLE active in production (${forcedModules.join(', ')}) — prefer Manager Dashboard module toggles`
    );
  } else {
    console.log(`[merlin:build] MODULES_FORCE_ENABLE: ${forcedModules.join(', ')}`);
  }
}

if (truthy(process.env.VOICE_TWILIO_SKIP_SIGNATURE)) {
  if (isProduction) {
    console.error(
      '[merlin:build] VOICE_TWILIO_SKIP_SIGNATURE must not be enabled in production — Twilio webhooks would skip signature verification'
    );
    process.exit(1);
  }
  console.warn(
    '[merlin:build] VOICE_TWILIO_SKIP_SIGNATURE is enabled — local tunnel only; never set on Vercel production'
  );
}

if (truthy(process.env.SMS_ENABLED)) {
  const smsMissing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'].filter(
    (k) => !process.env[k]?.trim()
  );
  if (smsMissing.length > 0) {
    if (isProduction) {
      console.error(
        `[merlin:build] SMS_ENABLED=true requires: ${smsMissing.join(', ')} (Video MPI SMS delivery)`
      );
      process.exit(1);
    }
    console.warn(`[merlin:build] SMS_ENABLED=true but incomplete Twilio SMS config: ${smsMissing.join(', ')}`);
  }
}

if (forcedModules.includes('voice_agent')) {
  const voiceMissing = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'].filter((k) => !process.env[k]?.trim());
  if (voiceMissing.length > 0) {
    if (isProduction) {
      console.error(
        `[merlin:build] voice_agent force-enabled but missing: ${voiceMissing.join(', ')}`
      );
      process.exit(1);
    }
    console.warn(`[merlin:build] voice_agent force-enabled but Twilio incomplete: ${voiceMissing.join(', ')}`);
  }
} else if (!process.env.TWILIO_ACCOUNT_SID?.trim() || !process.env.TWILIO_AUTH_TOKEN?.trim()) {
  console.warn(
    '[merlin:build] Twilio voice credentials optional until AI Voice Agent is used (TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)'
  );
}

if (forcedModules.includes('cdk_sync')) {
  console.warn(
    '[merlin:build] cdk_sync force-enabled but live CDK Global sync is deferred (PR-M7) — no runtime client yet'
  );
}

console.log(`[merlin:build] Environment OK — commit ${process.env.NEXT_PUBLIC_BUILD_COMMIT}`);