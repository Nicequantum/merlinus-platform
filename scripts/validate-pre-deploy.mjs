#!/usr/bin/env node
/**
 * Final pre-production deploy gate — read-only checks except a light DB ping.
 * Safe to run before every production deploy; does not mutate application data.
 *
 * Distinguishes:
 *   - CODE defects (block exit 1) — missing source guards, forbidden public keys, etc.
 *   - ENV / deployment gaps (warn, non-blocking in local/CI) — Sentry DSN, DB reachability
 *
 * Strict production blocking for env connectivity:
 *   VERCEL_ENV=production or MERLIN_DEPLOY_GATE=production
 *
 * Usage:
 *   npm run validate:pre-deploy
 *
 * Loads .env, .env.local, and .env.production from the repo root (same as validate-env).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyApexDatabaseEnv } from './resolve-apex-database-env.mjs';

const PREFIX = '[merlin:pre-deploy]';
const ROOT = process.cwd();
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

const AI_ROUTE_FILES = [
  'src/app/api/diagnostics/extract/route.ts',
  'src/app/api/repair-orders/extract/route.ts',
  'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
  'src/app/api/repair-orders/[id]/lines/[lineId]/score-story/route.ts',
  'src/app/api/repair-orders/[id]/lines/[lineId]/review-story/route.ts',
];

/** Merlinus v2 Phase 5 — encrypted-only PII writes; plaintext DB columns dropped. */
const PII_WRITE_GUARDS = [
  {
    file: 'src/lib/roMapper.ts',
    region: 'repairOrderToDbFields',
    // D1/SQLite: search tokens are JSON.stringify(buildRoNumberSearchTokens(...))
    requiredSnippets: [
      'roNumberEncrypted: encryptPII',
      'buildRoNumberSearchTokens',
      'JSON.stringify(buildRoNumberSearchTokens',
    ],
    forbiddenSnippets: ["roNumber: ''", 'roNumber: roNumber'],
  },
  {
    file: 'src/lib/roMapper.ts',
    region: 'repairLineToDbFields',
    requiredSnippets: ['descriptionEncrypted: encryptSensitiveText'],
    forbiddenSnippets: ["description: ''", 'description: line.description'],
  },
  {
    file: 'src/lib/advisorIntelligence/resolveAdvisor.ts',
    region: 'serviceAdvisor.create',
    requiredSnippets: ['displayNameEncrypted: encryptPII'],
    forbiddenSnippets: ["displayName: ''"],
  },
  {
    file: 'src/lib/advisorIntelligence/resolveAdvisor.ts',
    region: 'serviceAdvisorAlias.create',
    requiredSnippets: ['S2 PLAINTEXT WRITE', 'aliasText'],
  },
  {
    file: 'src/lib/advisorIntelligence/recomputeProfile.ts',
    region: 'advisorWritingProfile.upsert',
    requiredSnippets: ['S2 PLAINTEXT WRITE', 'profileDataEncrypted', 'encryptJsonObject'],
  },
];

/** Code defects that must block ready-to-deploy. */
const failures = [];
/** Env/deployment gaps — non-blocking outside strict production deploy gate. */
const warnings = [];

/**
 * True only for real production deploy contexts.
 * Local `npm run ready-to-deploy` and CI without VERCEL_ENV=production stay non-strict
 * so missing optional monitoring / unreachable remote DB do not fail the gate.
 */
function isStrictProductionDeployGate() {
  const vercel = process.env.VERCEL_ENV?.trim().toLowerCase();
  const gate = process.env.MERLIN_DEPLOY_GATE?.trim().toLowerCase();
  return vercel === 'production' || gate === 'production';
}

function loadDotEnvFile(filename) {
  const path = resolve(ROOT, filename);
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

function fail(message) {
  failures.push(message);
  console.error(`${PREFIX} ${RED}FAIL${RESET}: ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`${PREFIX} ${YELLOW}WARN${RESET}: ${message}`);
}

function pass(message) {
  console.log(`${PREFIX} ${GREEN}OK${RESET}: ${message}`);
}

function readSrc(relativePath) {
  const path = resolve(ROOT, relativePath);
  if (!existsSync(path)) {
    fail(`Missing source file: ${relativePath}`);
    return '';
  }
  return readFileSync(path, 'utf8');
}

function extractRegion(source, regionName) {
  const start = source.indexOf(regionName);
  if (start < 0) return '';
  const lookback = Math.max(0, start - 500);
  return source.slice(lookback, start + 2500);
}

function checkProductionEnv() {
  console.log(`${PREFIX} Running build-time environment validation (production mode)...`);
  try {
    execSync('node scripts/validate-env.mjs', {
      stdio: 'inherit',
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
    });
    pass('Core production environment variables (validate-env)');
  } catch {
    fail('Core production environment validation failed — see messages above');
  }
}

const FORBIDDEN_PUBLIC_GROK_KEYS = [
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
  'NEXT_PUBLIC_XAI_KEY',
];

function checkForbiddenPublicGrokKeys() {
  const exposed = FORBIDDEN_PUBLIC_GROK_KEYS.filter((key) => process.env[key]?.trim());
  if (exposed.length > 0) {
    fail(
      `Forbidden public xAI API keys detected: ${exposed.join(', ')}. ` +
        'Delete from Vercel and use server-only GROK_API_KEY.'
    );
    return;
  }
  pass('No forbidden NEXT_PUBLIC_* xAI API keys (GROK_API_KEY is server-only)');
}

function checkScanningEnvironment() {
  const scanningRequired = ['BLOB_READ_WRITE_TOKEN', 'GROK_API_KEY'];
  const missing = scanningRequired.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    fail(
      `Scanning environment incomplete (missing: ${missing.join(', ')}) — RO and Xentry photo scanning will fail. ` +
        'On Vercel: Project → Storage → connect a Blob store, then confirm BLOB_READ_WRITE_TOKEN in Environment Variables.'
    );
    return;
  }
  pass('Scanning environment (BLOB_READ_WRITE_TOKEN + GROK_API_KEY)');
}

function checkSentryDsn() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) {
    // Optional in local/CI — production should still set it on Vercel, but do not block code gates.
    warn(
      'NEXT_PUBLIC_SENTRY_DSN is not set — production error monitoring will be disabled until configured on Vercel'
    );
    return;
  }
  pass('NEXT_PUBLIC_SENTRY_DSN is configured');
}

function checkAiRouteMaxDuration() {
  for (const relativePath of AI_ROUTE_FILES) {
    const source = readSrc(relativePath);
    if (!source) continue;
    const match = source.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
    if (!match) {
      fail(`${relativePath} is missing export const maxDuration = <seconds>`);
      continue;
    }
    const seconds = Number(match[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      fail(`${relativePath} has invalid maxDuration: ${match[1]}`);
      continue;
    }
    pass(`${relativePath} maxDuration=${seconds}s`);
  }
}

function checkPlaintextPiiWriteGuards() {
  const warnings = [];

  for (const guard of PII_WRITE_GUARDS) {
    const source = readSrc(guard.file);
    if (!source) continue;
    const region = extractRegion(source, guard.region);
    if (!region) {
      warnings.push(`${guard.file}: region "${guard.region}" not found`);
      continue;
    }
    for (const snippet of guard.requiredSnippets) {
      if (!region.includes(snippet)) {
        warnings.push(`${guard.file} (${guard.region}): missing "${snippet}"`);
      }
    }
    for (const snippet of guard.forbiddenSnippets ?? []) {
      if (region.includes(snippet)) {
        warnings.push(`${guard.file} (${guard.region}): forbidden plaintext write "${snippet}"`);
      }
    }
  }

  const roMapper = readSrc('src/lib/roMapper.ts');
  const undocumentedPatterns = [
    { label: 'roNumber encrypted write in repairOrderToDbFields', ok: roMapper.includes('roNumberEncrypted: encryptPII(roNumber)') },
    {
      label: 'roNumber search tokens in repairOrderToDbFields',
      ok:
        roMapper.includes('JSON.stringify(buildRoNumberSearchTokens(roNumber))') ||
        (roMapper.includes('roNumberSearchTokens:') &&
          roMapper.includes('JSON.stringify(buildRoNumberSearchTokens')),
    },
    { label: 'description encrypted write in repairLineToDbFields', ok: roMapper.includes('descriptionEncrypted: encryptSensitiveText(line.description)') },
  ];
  for (const pattern of undocumentedPatterns) {
    if (!pattern.ok) warnings.push(pattern.label);
  }

  const auditedFiles = [...new Set(PII_WRITE_GUARDS.map((guard) => guard.file))];
  let s2MarkerTotal = 0;
  for (const file of auditedFiles) {
    const source = readSrc(file);
    const matches = source.match(/S2 PLAINTEXT WRITE/g);
    s2MarkerTotal += matches ? matches.length : 0;
  }
  if (s2MarkerTotal < 2) {
    warnings.push(`Expected at least 2 documented S2 PLAINTEXT WRITE markers (alias/profile), found ${s2MarkerTotal}`);
  }

  const schema = readSrc('prisma/schema.prisma');
  if (schema.includes('roNumber                   String') || schema.includes('description               String')) {
    warnings.push('schema still defines dual-storage plaintext PII columns');
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      fail(`Plaintext PII write guard: ${warning}`);
    }
    return;
  }

  pass('Encrypted-only PII writes verified (Phase 5 — plaintext columns dropped)');
}

function checkOptimisticConcurrencyGuard() {
  const putRoute = readSrc('src/app/api/repair-orders/[id]/route.ts');
  const validation = readSrc('src/lib/validation.ts');
  const hasPutCheck =
    putRoute.includes('data.updatedAt') && putRoute.includes('CONFLICT_ERROR') && putRoute.includes('409');
  const hasSchema = validation.includes('updatedAt: z.string().datetime().optional()');
  if (!hasPutCheck || !hasSchema) {
    fail('Repair order optimistic concurrency guard missing on PUT route or validation schema');
    return;
  }
  pass('Repair order optimistic concurrency guard present (optional updatedAt → 409)');
}

/** Product modules — encrypted PII writes + core_story never gated. */
function checkProductModuleHardening() {
  const deptCreate = readSrc('src/app/api/department-requests/route.ts');
  const deptRequired = [
    'summaryEncrypted: encryptSensitiveText',
    'customerNameEncrypted: encryptSensitiveText',
    'customerPhoneEncrypted: encryptSensitiveText',
    'vinEncrypted: encryptSensitiveText',
  ];
  for (const snippet of deptRequired) {
    if (!deptCreate.includes(snippet)) {
      fail(`Department request create missing encrypted write: ${snippet}`);
    }
  }
  if (deptCreate.includes(deptRequired[0])) {
    pass('Department inbox creates encrypt PII (summary/name/phone/VIN)');
  }

  const voiceTools = readSrc('src/lib/voiceAgent/tools.ts');
  if (
    !voiceTools.includes('encryptSensitiveText') ||
    !voiceTools.includes("source: 'voice_agent'")
  ) {
    fail('Voice agent department ticket create must encrypt sensitive fields and set source voice_agent');
  } else {
    pass('Voice agent createDepartmentTicket encrypts sensitive fields');
  }

  const twilio = readSrc('src/lib/voiceAgent/twilio.ts');
  if (!twilio.includes('isProduction') || !twilio.includes('VOICE_TWILIO_SKIP_SIGNATURE')) {
    fail('Twilio signature validation must refuse skip in production');
  } else {
    pass('Twilio signature skip is production-fail-closed');
  }

  const catalog = readSrc('src/lib/modules/catalog.ts');
  if (/\bcore_story\b/.test(catalog.match(/export const PRODUCT_MODULE_IDS[\s\S]*?\] as const/)?.[0] || '')) {
    fail('PRODUCT_MODULE_IDS must not include core_story');
  } else {
    pass('core_story is not a product module id');
  }

  const modulesRoute = readSrc('src/app/api/modules/route.ts');
  if (!modulesRoute.includes('export async function PATCH') || !modulesRoute.includes("action: 'module.set'")) {
    fail('Manager modules API must support PATCH + audited module.set');
  } else {
    pass('Manager modules API has audited enable/disable path');
  }

  const skipSig = process.env.VOICE_TWILIO_SKIP_SIGNATURE?.trim()?.toLowerCase();
  if (skipSig === 'true' || skipSig === '1' || skipSig === 'yes') {
    if (isStrictProductionDeployGate()) {
      fail('VOICE_TWILIO_SKIP_SIGNATURE must not be set for production deploy gate');
    } else {
      warn('VOICE_TWILIO_SKIP_SIGNATURE is set — local only; unset before production');
    }
  }

  const force = process.env.MODULES_FORCE_ENABLE?.trim();
  if (force) {
    warn(`MODULES_FORCE_ENABLE is set (${force}) — prefer rooftop toggles in production`);
  }
}

async function checkDatabaseConnection() {
  const strict = isStrictProductionDeployGate();
  const reportEnvIssue = (message) => {
    if (strict) {
      fail(message);
    } else {
      warn(`${message} (non-production — does not block ready-to-deploy)`);
    }
  };

  if (!process.env.DATABASE_URL?.trim()) {
    reportEnvIssue('DATABASE_URL is not set — cannot run database connectivity check');
    return;
  }

  try {
    execSync('npx prisma generate', { stdio: 'pipe', cwd: ROOT });
  } catch (error) {
    // Prisma generate is a toolchain/code gate — always block.
    fail(`Prisma client generation failed: ${error instanceof Error ? error.message : 'unknown'}`);
    return;
  }

  let prisma;
  try {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    pass('Database connection (Prisma $queryRaw SELECT 1)');
  } catch (error) {
    reportEnvIssue(
      `Database connection failed: ${error instanceof Error ? error.message : 'unknown'} — verify DATABASE_URL and network access`
    );
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

async function main() {
  console.log(`${PREFIX} Starting pre-deploy validation...`);
  if (isStrictProductionDeployGate()) {
    console.log(`${PREFIX} Strict production deploy gate (VERCEL_ENV/MERLIN_DEPLOY_GATE=production)`);
  } else {
    console.log(
      `${PREFIX} Local/CI mode — env gaps (Sentry, DB reachability) are warnings; only code defects block`
    );
  }

  loadDotEnvFile('.env');
  loadDotEnvFile('.env.local');
  loadDotEnvFile('.env.production');
  const apexEnvEnabled = ['1', 'true', 'yes'].includes(process.env.APEX_ENV?.trim().toLowerCase());
  if (apexEnvEnabled) {
    loadDotEnvFile('.env.apex.local');
  }

  const apexDb = applyApexDatabaseEnv({ loadApexEnvFile: false });
  if (apexDb.applied) {
    pass('Apex Supabase Postgres resolved for DATABASE_URL');
  }

  checkProductionEnv();
  checkForbiddenPublicGrokKeys();
  checkScanningEnvironment();
  checkSentryDsn();
  checkAiRouteMaxDuration();
  checkPlaintextPiiWriteGuards();
  checkOptimisticConcurrencyGuard();
  checkProductModuleHardening();
  await checkDatabaseConnection();

  if (warnings.length > 0) {
    console.warn(`${PREFIX} ${warnings.length} environment warning(s) — set on Vercel before production traffic.`);
  }

  if (failures.length > 0) {
    console.error(`${PREFIX} ${failures.length} code check(s) failed — aborting deploy.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(
      `${PREFIX} Code checks passed with ${warnings.length} env warning(s) — ready-to-deploy may proceed; fix env on Vercel for production.`
    );
  } else {
    console.log(`${PREFIX} All checks passed — safe to deploy to production.`);
  }
}

main().catch((error) => {
  console.error(`${PREFIX} Unexpected error:`, error);
  process.exit(1);
});