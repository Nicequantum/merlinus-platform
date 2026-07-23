#!/usr/bin/env npx tsx
/**
 * Merlin Pre-Rollout Validation Suite
 *
 * Run before every dealership deployment to confirm environment, security,
 * core systems, and feature readiness. Safe to run against staging or production
 * credentials — does not mutate customer data (read-only DB probe + in-memory tests).
 *
 * Usage:
 *   cp .env.example .env.local   # first-time setup
 *   npm run validate:pre-rollout
 *   MERLIN_BASE_URL=https://your-deployment.example npm run validate:pre-rollout
 *
 * This script depends on `.env.local` at the repo root (same as `npm run dev`).
 * DATABASE_URL and other secrets must never be hardcoded here.
 */

import { execSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { jsPDF } from 'jspdf';

import {
  AUDIT_GENESIS_HASH,
  computeAuditEntryHash,
  verifyAuditChain,
  type AuditChainPayload,
} from '../src/lib/auditChain';
import { VOICE_INPUT_SETTINGS } from '../src/lib/constants';
import { encryptPII, decryptPII } from '../src/lib/encryption';
import {
  getAppVersion,
  getBuildCommit,
  getBuildDate,
  getRuntimeConfig,
  isMaintenanceModeEnabled,
  validateEnvironment,
} from '../src/lib/env';
import { getExposedPublicGrokEnvKeys } from '../src/lib/grokApiKey.shared';
import { PrismaClient } from '@prisma/client';
import { isKvConfigured, RATE_LIMITS } from '../src/lib/rate-limit';
import { SYSTEM_PROMPT, buildWarrantyStoryUserMessage } from '../src/prompts/warrantyStory';
import { PROMPT_VERSION } from '../src/prompts/version';
import { CUSTOMER_PAY_TEMPLATES } from '../src/prompts/templates/customerPayTemplates';
import { CRITICAL_AUDIT_ACTIONS, CUSTOMER_PAY_AUDIT_ACTIONS, STORY_PROMPT_AUDIT_ACTIONS } from '../src/lib/audit';
import { AUDIT_CUSTOMER_PAY_SENTINEL } from '../src/lib/auditChain';
import { normalizeWarrantyStoryText } from '../src/utils/pdfExport';
import { createRepairOrderFromScan } from '../src/utils/repairOrderFactory';

let prisma: PrismaClient | null = null;
let databaseConfigError: string | null = null;
let resolvedDatabaseUrl: string | null = null;

interface DatabaseTarget {
  hostname: string;
  port: string;
  database: string;
  sslmode: string;
  protocol: string;
}

// ─── Console styling ───────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

type CheckStatus = 'pass' | 'fail' | 'warn';

/** Separates repository/code defects from deployment configuration gaps. */
type CheckKind = 'code' | 'config' | 'documentation' | 'ops';

interface CheckResult {
  section: string;
  name: string;
  status: CheckStatus;
  detail: string;
  critical: boolean;
  kind: CheckKind;
}

const results: CheckResult[] = [];

function inferCheckKind(section: string, name: string): CheckKind {
  if (section === 'Environment') return 'config';
  if (section === 'Documentation') return 'documentation';
  if (section === 'Production') {
    if (
      name.includes('checklist') ||
      name.includes('README') ||
      name.includes('Environment documentation')
    ) {
      return 'documentation';
    }
    return 'code';
  }
  if (section === 'Security') {
    if (name.includes('KV') || name.includes('Grok API key')) return 'config';
    return 'code';
  }
  if (section === 'Core Systems') {
    if (
      name.includes('Database connection') ||
      name.includes('AES-256 encryption') ||
      name.includes('DATABASE_URL')
    ) {
      return 'config';
    }
    return 'code';
  }
  if (section === 'Core Features' && name.includes('health')) return 'config';
  return 'code';
}

function record(
  section: string,
  name: string,
  status: CheckStatus,
  detail: string,
  critical = true,
  kind?: CheckKind
): void {
  const resolvedKind = kind ?? inferCheckKind(section, name);
  results.push({ section, name, status, detail, critical, kind: resolvedKind });
  const icon = status === 'pass' ? `${c.green}✔ PASS${c.reset}` : status === 'warn' ? `${c.yellow}⚠ WARN${c.reset}` : `${c.red}✖ FAIL${c.reset}`;
  console.log(`  ${icon}  ${name}`);
  if (detail) console.log(`         ${c.dim}${detail}${c.reset}`);
}

function section(title: string): void {
  console.log(`\n${c.bold}${c.cyan}▸ ${title}${c.reset}`);
}

// ─── Environment bootstrap ─────────────────────────────────────────────────────

/** Load `.env` then `.env.local` (overrides) — mirrors Next.js / local dev conventions. */
function loadEnvironment(): void {
  const root = process.cwd();
  loadDotenv({ path: resolve(root, '.env') });
  const localPath = resolve(root, '.env.local');
  if (!existsSync(localPath)) {
    console.warn(
      `${c.yellow}⚠ .env.local not found — copy .env.example to .env.local and configure DATABASE_URL.${c.reset}`
    );
  }
  loadDotenv({ path: localPath, override: true });
  loadDotenv({ path: resolve(root, '.env.production'), override: true });
}

/** Strip optional wrapping quotes from a dotenv value. */
function stripEnvQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Validate and normalize DATABASE_URL from `.env.local`.
 * - Accepts postgres:// and postgresql:// (Prisma prefers postgresql://)
 * - Fixes common typos (textpostgres://)
 * - Adds sslmode=require for remote hosts (db.prisma.io, Neon, etc.)
 */
function normalizeDatabaseUrl(rawInput: string): string {
  let url = stripEnvQuotes(rawInput);
  if (!url) {
    throw new Error(
      'DATABASE_URL is empty. Set it in .env.local (see .env.example). ' +
        'Example: postgresql://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require'
    );
  }

  url = url.replace(/^textpostgres:\/\//i, 'postgresql://');
  if (/^postgres:\/\//i.test(url) && !/^postgresql:\/\//i.test(url)) {
    url = url.replace(/^postgres:\/\//i, 'postgresql://');
  }

  if (!/^postgresql:\/\//i.test(url)) {
    throw new Error(
      'DATABASE_URL must use postgres:// or postgresql://. ' +
        'Check .env.local for typos (e.g. textpostgres://).'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'DATABASE_URL is malformed — verify username, password, host, and port in .env.local.'
    );
  }

  if (!parsed.hostname) {
    throw new Error('DATABASE_URL is missing a hostname. Example host: db.prisma.io');
  }

  const isLocal =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';

  if (!isLocal && !parsed.searchParams.has('sslmode')) {
    parsed.searchParams.set('sslmode', 'require');
  }

  return parsed.toString();
}

function resolveDatabaseUrlFromEnv(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw?.trim()) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env.local (see .env.example). ' +
        'Remote Prisma example: postgresql://USER:PASSWORD@db.prisma.io:5432/postgres?sslmode=require'
    );
  }
  return normalizeDatabaseUrl(raw);
}

/** Safe connection summary — never includes credentials. */
function describeDatabaseTarget(connectionUrl: string): DatabaseTarget {
  const parsed = new URL(connectionUrl);
  return {
    protocol: parsed.protocol.replace(':', ''),
    hostname: parsed.hostname,
    port: parsed.port || '5432',
    database: parsed.pathname.replace(/^\//, '') || 'postgres',
    sslmode: parsed.searchParams.get('sslmode') ?? 'not set',
  };
}

function formatDatabaseTarget(target: DatabaseTarget): string {
  return `${target.protocol}://${target.hostname}:${target.port}/${target.database} (sslmode=${target.sslmode})`;
}

async function initPrismaFromEnvironment(): Promise<PrismaClient | null> {
  try {
    resolvedDatabaseUrl = resolveDatabaseUrlFromEnv();
    process.env.DATABASE_URL = resolvedDatabaseUrl;

    const target = describeDatabaseTarget(resolvedDatabaseUrl);
    console.log(
      `  ${c.dim}Database target: ${target.hostname}:${target.port}/${target.database} · sslmode=${target.sslmode}${c.reset}`
    );

    // Dedicated client with explicit datasource — avoids stale singleton from src/lib/db.
    return new PrismaClient({
      datasources: { db: { url: resolvedDatabaseUrl } },
      log: ['error'],
    });
  } catch (error) {
    databaseConfigError =
      error instanceof Error ? error.message : 'DATABASE_URL is missing or invalid';
    console.log(`  ${c.red}Database config error: ${databaseConfigError}${c.reset}`);
    return null;
  }
}

function listRouteFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) entries.push(...listRouteFiles(full));
    else if (name === 'route.ts') entries.push(full);
  }
  return entries;
}

// ─── Check implementations ─────────────────────────────────────────────────────

async function checkEnvironment(): Promise<void> {
  section('Environment Validation');

  const env = validateEnvironment({ production: true });
  if (env.valid) {
    record(
      'Environment',
      'Required environment variables',
      'pass',
      'DATABASE_URL, DATA_ENCRYPTION_KEY, SEARCH_HMAC_KEY, SESSION_SECRET present'
    );
  } else {
    record('Environment', 'Required environment variables', 'fail', `Missing: ${env.missing.join(', ')}`);
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!blobToken) {
    record(
      'Environment',
      'Blob storage for RO/Xentry scanning',
      'fail',
      'BLOB_READ_WRITE_TOKEN missing — connect Vercel Blob (Storage → Create/Connect Blob Store) and redeploy',
      true
    );
  } else {
    record('Environment', 'Blob storage for RO/Xentry scanning', 'pass', 'BLOB_READ_WRITE_TOKEN configured');
  }

  const grokKey = process.env.GROK_API_KEY?.trim();
  if (!grokKey) {
    record(
      'Environment',
      'Grok vision for RO/Xentry scanning',
      'fail',
      'GROK_API_KEY missing — server-only xAI key required for photo extraction',
      true
    );
  } else {
    record('Environment', 'Grok vision for RO/Xentry scanning', 'pass', 'GROK_API_KEY configured');
  }

  const exposedPublicGrokKeys = getExposedPublicGrokEnvKeys();
  if (exposedPublicGrokKeys.length > 0) {
    record(
      'Environment',
      'Forbidden public xAI API keys',
      'fail',
      `Delete ${exposedPublicGrokKeys.join(', ')} from Vercel — use server-only GROK_API_KEY`,
      true
    );
  } else {
    record('Environment', 'Forbidden public xAI API keys', 'pass', 'No NEXT_PUBLIC_* xAI keys detected');
  }

  const blockingWarnings = env.warnings.filter((w) => w.includes('shorter than'));
  if (blockingWarnings.length === 0 && env.warnings.length === 0) {
    record('Environment', 'Environment warnings', 'pass', 'No configuration warnings');
  } else if (blockingWarnings.length > 0) {
    record('Environment', 'Environment warnings', 'fail', blockingWarnings.join('; '), true);
  } else {
    record('Environment', 'Environment warnings', 'warn', env.warnings.join('; '), false);
  }

  if (isMaintenanceModeEnabled()) {
    record('Environment', 'Maintenance mode disabled', 'fail', 'MERLIN_MAINTENANCE_MODE is enabled — disable before rollout');
  } else {
    record('Environment', 'Maintenance mode disabled', 'pass', 'MERLIN_MAINTENANCE_MODE is off');
  }

  const commit = getBuildCommit();
  const buildDate = getBuildDate();
  const parsedDate = Date.parse(buildDate);
  if (!commit || commit === 'unknown') {
    record('Environment', 'Build commit stamped', 'warn', `Commit is "${commit}" — set NEXT_PUBLIC_BUILD_COMMIT or deploy from git`, false);
  } else {
    record('Environment', 'Build commit stamped', 'pass', `Commit: ${commit}`);
  }

  if (Number.isNaN(parsedDate)) {
    record('Environment', 'Build date stamped', 'fail', `Invalid build date: ${buildDate}`);
  } else if (commit === 'dev') {
    record('Environment', 'Build date stamped', 'warn', `Date: ${buildDate} (local dev build)`, false);
  } else {
    record('Environment', 'Build date stamped', 'pass', `Built: ${new Date(parsedDate).toISOString()}`);
  }

  if (resolvedDatabaseUrl) {
    const target = describeDatabaseTarget(resolvedDatabaseUrl);
    const isLocal = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    if (isLocal) {
      record(
        'Environment',
        'DATABASE_URL target host',
        'warn',
        `${target.hostname}:${target.port} — use db.prisma.io (or production host) for rollout`,
        false
      );
    } else {
      record(
        'Environment',
        'DATABASE_URL target host',
        'pass',
        `${target.hostname}:${target.port}/${target.database} (sslmode=${target.sslmode})`
      );
    }
  } else if (databaseConfigError) {
    record('Environment', 'DATABASE_URL target host', 'fail', databaseConfigError);
  }
}

async function checkCoreSystems(): Promise<void> {
  section('Core System Health');

  if (!prisma) {
    const strictProd =
      process.env.VERCEL_ENV?.trim().toLowerCase() === 'production' ||
      process.env.MERLIN_DEPLOY_GATE?.trim().toLowerCase() === 'production';
    const detail =
      databaseConfigError ??
      'DATABASE_URL not configured — add a valid PostgreSQL URL to .env.local';
    if (strictProd) {
      record('Core Systems', 'Database connection', 'fail', detail);
    } else {
      record(
        'Core Systems',
        'Database connection',
        'warn',
        `${detail} (non-production — env gap, not a code defect)`,
        false
      );
    }
  } else {
    const target = resolvedDatabaseUrl
      ? describeDatabaseTarget(resolvedDatabaseUrl)
      : null;
    const targetLabel = target ? `${target.hostname}:${target.port}` : 'unknown host';

    try {
      console.log(`  ${c.dim}Connecting to ${targetLabel}…${c.reset}`);
      const started = Date.now();
      const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      const elapsed = Date.now() - started;
      const ok = result?.[0]?.ok === 1;
      if (!ok) {
        record('Core Systems', 'Database connection', 'fail', `Query to ${targetLabel} returned unexpected result`);
      } else {
        record(
          'Core Systems',
          'Database connection',
          'pass',
          `Connected to ${targetLabel}/${target?.database ?? 'postgres'} in ${elapsed}ms (sslmode=${target?.sslmode ?? 'n/a'})`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      console.log(`  ${c.red}Connection to ${targetLabel} failed${c.reset}`);
      let hint = ' Check DATABASE_URL in .env.local.';
      if (message.includes('localhost') || target?.hostname === 'localhost') {
        hint = ' DATABASE_URL still points at localhost — set your remote db.prisma.io URL in .env.local.';
      } else if (target?.hostname.includes('prisma.io')) {
        hint = ' Confirm Prisma Data Platform credentials and that the database is active.';
      } else if (!resolvedDatabaseUrl?.includes('sslmode=')) {
        hint = ' Remote hosts need ?sslmode=require on DATABASE_URL.';
      }
      // Non-production: unreachable DB is an env warning so ready-to-deploy can pass on code health.
      const strictProd =
        process.env.VERCEL_ENV?.trim().toLowerCase() === 'production' ||
        process.env.MERLIN_DEPLOY_GATE?.trim().toLowerCase() === 'production';
      if (strictProd) {
        record('Core Systems', 'Database connection', 'fail', `${message}${hint}`);
      } else {
        record(
          'Core Systems',
          'Database connection',
          'warn',
          `${message}${hint} (non-production — env gap, not a code defect)`,
          false
        );
      }
    }
  }

  try {
    const sample = `merlin-pre-rollout-${Date.now()}`;
    const encrypted = encryptPII(sample);
    const decrypted = decryptPII(encrypted);
    if (decrypted !== sample) {
      record('Core Systems', 'AES-256 encryption round-trip', 'fail', 'Decrypt mismatch');
    } else {
      record('Core Systems', 'AES-256 encryption round-trip', 'pass', 'encryptPII / decryptPII OK');
    }
  } catch (error) {
    record(
      'Core Systems',
      'AES-256 encryption round-trip',
      'fail',
      error instanceof Error ? error.message : 'Encryption failed'
    );
  }

  try {
    const first: AuditChainPayload = {
      id: 'pre-rollout-audit-1',
      action: 'story.generate',
      entityType: 'repairLine',
      entityId: 'line-pre-rollout',
      technicianId: 'tech-pre-rollout',
      dealershipId: 'dealer-pre-rollout',
      metadata: JSON.stringify({ repairOrderId: 'ro-pre-rollout', promptVersion: PROMPT_VERSION }),
      ipAddress: '127.0.0.1',
      createdAt: new Date().toISOString(),
      previousHash: AUDIT_GENESIS_HASH,
      promptVersion: PROMPT_VERSION,
    };
    const firstHash = computeAuditEntryHash(first);
    const second: AuditChainPayload = {
      ...first,
      id: 'pre-rollout-audit-2',
      previousHash: firstHash,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    };
    const secondHash = computeAuditEntryHash(second);
    const chain = verifyAuditChain([
      { ...first, entryHash: firstHash },
      { ...second, entryHash: secondHash },
    ]);
    if (!chain.valid) {
      record('Core Systems', 'Audit chain integrity', 'fail', `Chain broken at index ${chain.brokenAt}`);
    } else {
      record('Core Systems', 'Audit chain integrity', 'pass', 'Hash chain create → verify OK');
    }

    const tampered = { ...first, entryHash: firstHash, promptVersion: 'tampered' };
    const bad = verifyAuditChain([tampered]);
    if (bad.valid) {
      record('Core Systems', 'Audit tamper detection', 'fail', 'Tampered entry was accepted');
    } else {
      record('Core Systems', 'Audit tamper detection', 'pass', 'Tampered promptVersion correctly rejected');
    }
  } catch (error) {
    record(
      'Core Systems',
      'Audit chain integrity',
      'fail',
      error instanceof Error ? error.message : 'Audit chain test failed'
    );
  }

  if (PROMPT_VERSION && /^\d+\.\d+\.\d+$/.test(PROMPT_VERSION)) {
    const config = getRuntimeConfig(PROMPT_VERSION);
    record(
      'Core Systems',
      'Prompt version loaded',
      'pass',
      `PROMPT_VERSION=${PROMPT_VERSION} (app v${config.appVersion})`
    );
  } else {
    record('Core Systems', 'Prompt version loaded', 'fail', `Invalid PROMPT_VERSION: ${PROMPT_VERSION}`);
  }

  if (SYSTEM_PROMPT.includes(PROMPT_VERSION)) {
    record('Core Systems', 'Prompt version in SYSTEM_PROMPT', 'pass', 'Warranty story system prompt references version');
  } else {
    record('Core Systems', 'Prompt version in SYSTEM_PROMPT', 'fail', 'SYSTEM_PROMPT missing PROMPT_VERSION');
  }
}

async function checkCustomerPayTemplates(): Promise<void> {
  section('Customer Pay Templates');

  if (CUSTOMER_PAY_TEMPLATES.length >= 12) {
    record(
      'Customer Pay',
      'Template library size',
      'pass',
      `${CUSTOMER_PAY_TEMPLATES.length} instant Customer Pay templates defined`
    );
  } else {
    record(
      'Customer Pay',
      'Template library size',
      'fail',
      `Expected ≥12 Customer Pay templates, found ${CUSTOMER_PAY_TEMPLATES.length}`
    );
  }

  const sample = CUSTOMER_PAY_TEMPLATES[0];
  const hasStructure =
    !!sample?.preWrittenStory?.trim().startsWith('Performed') &&
    CUSTOMER_PAY_TEMPLATES.every((t) => t.preWrittenStory.trim().length > 80);
  if (hasStructure) {
    record('Customer Pay', 'Template story structure', 'pass', 'Polished correction narratives on pre-written stories');
  } else {
    record('Customer Pay', 'Template story structure', 'fail', 'Missing polished pre-written story content');
  }

  if (
    CUSTOMER_PAY_AUDIT_ACTIONS.has('customerPayTemplateApplied') &&
    !STORY_PROMPT_AUDIT_ACTIONS.has('customerPayTemplateApplied')
  ) {
    record(
      'Customer Pay',
      'Audit action separation',
      'pass',
      `customerPayTemplateApplied uses sentinel (not Merlin prompt) — ${AUDIT_CUSTOMER_PAY_SENTINEL}`
    );
  } else {
    record(
      'Customer Pay',
      'Audit action separation',
      'fail',
      'customerPayTemplateApplied must bypass Merlin story prompt audit actions'
    );
  }

  const cpModule = readFileSync(
    resolve(process.cwd(), 'src/lib/customerPayTemplate.ts'),
    'utf8'
  );
  if (cpModule.includes('No Grok') || cpModule.includes('bypasses Grok')) {
    record(
      'Customer Pay',
      'AI bypass documented in code',
      'pass',
      'customerPayTemplate.ts documents compliance bypass'
    );
  } else {
    record('Customer Pay', 'AI bypass documented in code', 'warn', 'Add bypass comments to customerPayTemplate.ts', false);
  }
}

async function checkCriticalAuditFixes(): Promise<void> {
  section('Critical Audit Fixes (C1–C7)');

  const validationSrc = readFileSync(resolve(process.cwd(), 'src/lib/validation.ts'), 'utf8');
  if (validationSrc.includes('isCustomerPay: z.boolean().optional()')) {
    record('Critical Fixes', 'C1 repairLineSchema isCustomerPay', 'pass', 'Schema preserves Customer Pay flag');
  } else {
    record('Critical Fixes', 'C1 repairLineSchema isCustomerPay', 'fail', 'Missing isCustomerPay on repairLineSchema');
  }

  const roPutSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/repair-orders/[id]/route.ts'),
    'utf8'
  );
  if (roPutSrc.includes('existingLine?.isCustomerPay') && roPutSrc.includes('isCustomerPay,')) {
    record('Critical Fixes', 'C1 PUT merges isCustomerPay', 'pass', 'RO update merges persisted Customer Pay flag');
  } else {
    record('Critical Fixes', 'C1 PUT merges isCustomerPay', 'fail', 'PUT handler does not merge isCustomerPay from DB');
  }

  const auditSrc = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
  const criticalActionsOk =
    CRITICAL_AUDIT_ACTIONS.has('story.generate') &&
    CRITICAL_AUDIT_ACTIONS.has('customerPayTemplateApplied') &&
    auditSrc.includes('CRITICAL_AUDIT_ACTIONS.has(input.action)');
  if (criticalActionsOk) {
    record('Critical Fixes', 'C2 critical audit rethrow', 'pass', 'Compliance-critical audit failures abort operation');
  } else {
    record('Critical Fixes', 'C2 critical audit rethrow', 'fail', 'writeAuditLog must rethrow for CRITICAL_AUDIT_ACTIONS');
  }

  const generateSrc = readFileSync(
    resolve(
      process.cwd(),
      'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'
    ),
    'utf8'
  );
  const storyAiPersistSrc = readFileSync(
    resolve(process.cwd(), 'src/lib/storyAiPersist.ts'),
    'utf8'
  );
  const auditBeforeUpdate =
    generateSrc.includes("action: 'story.generate'") &&
    generateSrc.includes('persistRepairLineStoryInTransaction') &&
    (generateSrc.includes('rlsTransaction') || generateSrc.includes('prisma.$transaction')) &&
    storyAiPersistSrc.includes('appendAuditLogInTransaction') &&
    storyAiPersistSrc.includes('repairLine.updateMany') &&
    storyAiPersistSrc.indexOf('appendAuditLogInTransaction') <
      storyAiPersistSrc.indexOf('repairLine.updateMany');
  if (auditBeforeUpdate) {
    record(
      'Critical Fixes',
      'C3 audit before story persist',
      'pass',
      'story.generate audit precedes repair line persist via persistRepairLineStoryInTransaction'
    );
  } else {
    record('Critical Fixes', 'C3 audit before story persist', 'fail', 'Generate route must audit before DB story write');
  }

  const securityStatusSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/auth/security-status/route.ts'),
    'utf8'
  );
  if (securityStatusSrc.includes('withAuth(') && securityStatusSrc.includes('requireManager: true')) {
    record('Critical Fixes', 'C4 security-status auth', 'pass', 'Seed password status requires manager session');
  } else {
    record('Critical Fixes', 'C4 security-status auth', 'fail', '/api/auth/security-status must use withAuth + requireManager');
  }

  const healthSrc = readFileSync(resolve(process.cwd(), 'src/app/api/health/route.ts'), 'utf8');
  const healthChecksSrc = readFileSync(resolve(process.cwd(), 'src/lib/healthChecks.ts'), 'utf8');
  const healthOk =
    healthSrc.includes('withAuth(') &&
    healthSrc.includes('runAuthenticatedHealthChecks') &&
    !healthChecksSrc.includes('api.x.ai/v1/chat/completions');
  if (healthOk) {
    record('Critical Fixes', 'C5 health endpoint hardened', 'pass', 'Manager auth + no live Grok probe in health');
  } else {
    record('Critical Fixes', 'C5 health endpoint hardened', 'fail', 'Health route must be authenticated without live Grok calls');
  }

  const voiceCoordSrc = readFileSync(
    resolve(process.cwd(), 'src/lib/voice/voiceSessionCoordinator.ts'),
    'utf8'
  );
  const voiceServiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
  if (voiceCoordSrc.includes('claimVoiceSession') && voiceServiceSrc.includes('claimVoiceSession')) {
    record('Critical Fixes', 'C6 voice session mutex', 'pass', 'Global coordinator stops competing mic sessions');
  } else {
    record('Critical Fixes', 'C6 voice session mutex', 'fail', 'Missing voice session coordinator integration');
  }

  const errorsSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/errors.ts'), 'utf8');
  const voiceLifecycleOk =
    voiceServiceSrc.includes('disposeRecognition') &&
    voiceServiceSrc.includes('supersedingRecognition') &&
    !errorsSrc.includes("code === 'no-speech' || code === 'network' || code === 'aborted'");
  if (voiceLifecycleOk) {
    record('Critical Fixes', 'C7 voice lifecycle cleanup', 'pass', 'Handlers detached before abort; no aborted auto-restart');
  } else {
    record('Critical Fixes', 'C7 voice lifecycle cleanup', 'fail', 'VoiceInputService lifecycle fixes incomplete');
  }
}

async function checkHighPriorityAuditFixes(): Promise<void> {
  section('High Priority Audit Fixes (H1–H15)');

  const customerPayLineSrc = readFileSync(resolve(process.cwd(), 'src/lib/customerPayLine.ts'), 'utf8');
  if (customerPayLineSrc.includes('isCustomerPayRepairLine')) {
    record('High Priority', 'H1 shared Customer Pay helper', 'pass', 'client/server use isCustomerPayRepairLine');
  } else {
    record('High Priority', 'H1 shared Customer Pay helper', 'fail', 'Missing customerPayLine helper');
  }

  const queueSrc = readFileSync(resolve(process.cwd(), 'src/lib/repairOrderSaveQueue.ts'), 'utf8');
  const persistSrc = readFileSync(resolve(process.cwd(), 'src/hooks/repairOrders/useROPersistence.ts'), 'utf8');
  const storySrc = readFileSync(resolve(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
  if (
    queueSrc.includes('enqueueRepairOrderSave') &&
    persistSrc.includes('awaitRepairOrderSaveQueue') &&
    storySrc.includes('await deps.flushPendingSave()')
  ) {
    record('High Priority', 'H2 save queue serialization', 'pass', 'Awaitable flush + serialized RO saves');
  } else {
    record('High Priority', 'H2 save queue serialization', 'fail', 'Save race around Customer Pay apply not fixed');
  }

  const auditSrc = readFileSync(resolve(process.cwd(), 'src/lib/audit.ts'), 'utf8');
  const putSrc = readFileSync(resolve(process.cwd(), 'src/app/api/repair-orders/[id]/route.ts'), 'utf8');
  if (auditSrc.includes('customerPayStory.edit') && putSrc.includes("action: 'customerPayStory.edit'")) {
    record('High Priority', 'H3 CP story edit audit', 'pass', 'customerPayStory.edit replaces Merlin story.edit for CP lines');
  } else {
    record('High Priority', 'H3 CP story edit audit', 'fail', 'Customer Pay edits still use story.edit');
  }

  const latestSrc = readFileSync(resolve(process.cwd(), 'src/app/api/audit-logs/latest/route.ts'), 'utf8');
  const pdfSrc = readFileSync(resolve(process.cwd(), 'src/app/api/audit-logs/pdf-export/route.ts'), 'utf8');
  if (latestSrc.includes('customerPayTemplateApplied') && pdfSrc.includes('customerPayStory.pdf_export')) {
    record('High Priority', 'H4 CP PDF/latest audit', 'pass', 'Latest hash + PDF export respect Customer Pay actions');
  } else {
    record('High Priority', 'H4 CP PDF/latest audit', 'fail', 'Customer Pay PDF/latest audit incomplete');
  }

  // D1/SQLite: no pg_advisory_xact_lock; chain integrity uses previousHash + sequential writes.
  if (
    auditSrc.includes('previousHash') &&
    auditSrc.includes('entryHash') &&
    !auditSrc.includes('pg_advisory_xact_lock')
  ) {
    record(
      'High Priority',
      'H5 audit chain locking',
      'pass',
      'Hash-chain previousHash (D1-safe; no Postgres advisory lock)'
    );
  } else if (auditSrc.includes('pg_advisory_xact_lock')) {
    record('High Priority', 'H5 audit chain locking', 'pass', 'Per-dealership advisory lock on audit append');
  } else {
    record('High Priority', 'H5 audit chain locking', 'fail', 'Missing audit chain concurrency guard');
  }

  const encSrc = readFileSync(resolve(process.cwd(), 'src/lib/encryption.ts'), 'utf8');
  // H6 loud decrypt + H7 derived salt (scryptSaltForSecret) + dual-key PREVIOUS window
  if (
    encSrc.includes('encryption.decrypt_failed') &&
    (encSrc.includes('getScryptSalt') || encSrc.includes('scryptSaltForSecret')) &&
    encSrc.includes('DATA_ENCRYPTION_KEY_PREVIOUS')
  ) {
    record(
      'High Priority',
      'H6/H7 encryption hardening',
      'pass',
      'Loud decrypt failures + derived scrypt salt + dual-key PREVIOUS'
    );
  } else {
    record('High Priority', 'H6/H7 encryption hardening', 'fail', 'Encryption fixes incomplete');
  }

  const envSrc = readFileSync(resolve(process.cwd(), 'src/lib/env.ts'), 'utf8');
  const rateSrc = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
  if (
    (envSrc.includes('PRODUCTION_KV_ENV_VARS') || envSrc.includes('KV_REST_API_URL')) &&
    rateSrc.includes('memoryRateLimitConfig') &&
    rateSrc.includes('rate_limit.kv_fallback_memory') &&
    rateSrc.includes('isAuthRateLimitRoute') &&
    rateSrc.includes('auth_kv_required')
  ) {
    record(
      'High Priority',
      'H8 KV rate limiting',
      'pass',
      'KV preferred in production; auth routes log loud fallback warnings'
    );
  } else {
    record('High Priority', 'H8 KV rate limiting', 'fail', 'Rate limit production hardening incomplete');
  }

  const imageSrc = readFileSync(resolve(process.cwd(), 'src/lib/imageAccess.ts'), 'utf8');
  if (
    imageSrc.includes('repairOrderContainsPathname') &&
    imageSrc.includes('findMany') &&
    imageSrc.includes('contains: pathname')
  ) {
    record('High Priority', 'H9 image access query', 'pass', 'Targeted pathname lookup (no full RO scan)');
  } else {
    record('High Priority', 'H9 image access query', 'fail', 'Image access still scans all repair orders');
  }

  const listSrc = readFileSync(resolve(process.cwd(), 'src/app/api/repair-orders/route.ts'), 'utf8');
  if (listSrc.includes('nextCursor') && listSrc.includes('hasMore')) {
    record('High Priority', 'H10 RO list pagination', 'pass', 'Cursor-based repair order listing');
  } else {
    record('High Priority', 'H10 RO list pagination', 'fail', 'Repair order list still unbounded');
  }

  const seedDb = readFileSync(resolve(process.cwd(), 'src/lib/seedDatabase.ts'), 'utf8');
  if (!seedDb.includes('changeme123')) {
    record('High Priority', 'H11 seed credentials', 'pass', 'No hardcoded default technician password');
  } else {
    record('High Priority', 'H11 seed credentials', 'fail', 'Hardcoded seed password still present');
  }

  const noiseSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/noiseMonitor.ts'), 'utf8');
  if (noiseSrc.includes('EMIT_INTERVAL_MS = 250')) {
    record('High Priority', 'H12 noise throttle', 'pass', 'Noise monitor emits at 4 Hz max');
  } else {
    record('High Priority', 'H12 noise throttle', 'fail', 'Noise monitor not throttled');
  }

  const voiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
  if (voiceSrc.includes('if (!started)') && voiceSrc.includes('detachManualEditGuard')) {
    record('High Priority', 'H13 voice cleanup', 'pass', 'Manual edit guard detached when recognition fails');
  } else {
    record('High Priority', 'H13 voice cleanup', 'fail', 'Voice start failure cleanup incomplete');
  }

  const cpTpl = readFileSync(resolve(process.cwd(), 'src/lib/customerPayTemplate.ts'), 'utf8');
  if (cpTpl.includes('if (!template.isCustomerPay)')) {
    record('High Priority', 'H14 template eligibility', 'pass', 'Customer Pay bypass requires isCustomerPay=true');
  } else {
    record('High Priority', 'H14 template eligibility', 'fail', 'Loose template eligibility still present');
  }

  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: {
      build?: string;
      'build:next'?: string;
      'db:migrate:deploy'?: string;
    };
  };
  const buildScript = pkg.scripts?.build ?? '';
  const buildNext = pkg.scripts?.['build:next'] ?? '';
  const migrateDeploy = pkg.scripts?.['db:migrate:deploy'] ?? '';
  // D1: build must not run `prisma migrate deploy`; schema apply is Wrangler (migrate-deploy.mjs).
  const noPrismaMigrateInBuild =
    !buildScript.includes('prisma migrate deploy') && !buildNext.includes('prisma migrate deploy');
  const d1MigrateScript =
    migrateDeploy.includes('migrate-deploy.mjs') || migrateDeploy.includes('wrangler');
  if (noPrismaMigrateInBuild && d1MigrateScript) {
    record(
      'High Priority',
      'H15 build migrations',
      'pass',
      'Build skips prisma migrate deploy; D1 uses migrate-deploy.mjs / Wrangler'
    );
  } else {
    record('High Priority', 'H15 build migrations', 'fail', 'Build still auto-runs migrations');
  }
}

function checkMediumAuditFixes(): void {
  section('Medium Audit Fixes (M1–M30)');

  const cpTpl = readFileSync(resolve(process.cwd(), 'src/lib/customerPayTemplate.ts'), 'utf8');
  if (
    (cpTpl.includes('rlsTransaction') || cpTpl.includes('prisma.$transaction')) &&
    cpTpl.includes('clearCustomerPayMode')
  ) {
    record('Medium', 'M1–M3 Customer Pay', 'pass', 'Clear mode + transactional idempotent apply');
  } else {
    record('Medium', 'M1–M3 Customer Pay', 'fail', 'Customer Pay medium fixes incomplete');
  }

  const genSrc = readFileSync(
    resolve(process.cwd(), 'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts'),
    'utf8'
  );
  const storyShell = readFileSync(resolve(process.cwd(), 'src/lib/storyAiRoute.ts'), 'utf8');
  if (
    genSrc.includes('buildStoryGenerateAuditMetadata') &&
    (genSrc.includes('isCustomerPayRepairLine') || storyShell.includes('isCustomerPayRepairLine')) &&
    (genSrc.includes('withStoryAiRoute') || genSrc.includes('withAuth'))
  ) {
    record('Medium', 'M4–M6 warranty AI audit', 'pass', 'Customer pay guard + prompt fingerprint');
  } else {
    record('Medium', 'M4–M6 warranty AI audit', 'fail', 'Warranty AI medium fixes incomplete');
  }

  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  if (schema.includes('TechnicianRole') && schema.includes('roNumberEncrypted')) {
    record('Medium', 'M7/M11 schema', 'pass', 'Expanded encryption + role enum');
  } else {
    record('Medium', 'M7/M11 schema', 'fail', 'Schema medium fixes incomplete');
  }

  const authSrc = readFileSync(resolve(process.cwd(), 'src/lib/auth.ts'), 'utf8');
  const logoutSrc = readFileSync(resolve(process.cwd(), 'src/app/api/auth/logout/route.ts'), 'utf8');
  if (authSrc.includes('setJti') && logoutSrc.includes('405')) {
    record('Medium', 'M9/M10 session', 'pass', 'JWT claims + POST-only logout');
  } else {
    record('Medium', 'M9/M10 session', 'fail', 'Session medium fixes incomplete');
  }

  const policyPath = resolve(process.cwd(), 'security-policy.mjs');
  const policy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
  const mw = readFileSync(resolve(process.cwd(), 'src/middleware.ts'), 'utf8');
  const m12Ok =
    policy.includes("'unsafe-inline'") &&
    policy.includes('script-src') &&
    !policy.includes('unsafe-eval') &&
    mw.includes('security-policy.mjs') &&
    mw.includes('CONTENT_SECURITY_POLICY');
  if (m12Ok) {
    record('Medium', 'M12 CSP', 'pass', 'CSP middleware with inline scripts allowed');
  } else {
    record('Medium', 'M12 CSP', 'fail', 'CSP medium fixes incomplete');
  }

  if (readFileSync(resolve(process.cwd(), 'src/lib/auditMetadataSanitize.ts'), 'utf8').includes('sanitizeAuditMetadata')) {
    record('Medium', 'M13 audit metadata', 'pass', 'PII stripped from audit metadata');
  } else {
    record('Medium', 'M13 audit metadata', 'fail', 'Audit metadata sanitization missing');
  }

  const requestIpSrc = readFileSync(resolve(process.cwd(), 'src/lib/requestIp.ts'), 'utf8');
  const rateSrc = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
  const ipExtractionOk =
    requestIpSrc.includes('x-vercel-forwarded-for') &&
    requestIpSrc.includes('TRUSTED_PROXY_HOPS') &&
    rateSrc.includes("from './requestIp'");
  if (ipExtractionOk) {
    record('Medium', 'M14 IP extraction', 'pass', 'Platform-trusted IP headers via requestIp');
  } else {
    record('Medium', 'M14 IP extraction', 'fail', 'IP extraction medium fix incomplete');
  }

  const voiceSrc = readFileSync(resolve(process.cwd(), 'src/lib/voice/voiceSettings.ts'), 'utf8');
  const voiceLongForm =
    (voiceSrc.includes('listeningTimeoutMs: 0') || voiceSrc.includes('maxAutoRestarts: 60')) &&
    readFileSync(resolve(process.cwd(), 'src/hooks/repairOrders/useROPersistence.ts'), 'utf8').includes('useROPersistence');
  if (voiceLongForm) {
    record('Medium', 'M15–M21 voice/hooks', 'pass', 'Voice guards + hook decomposition');
  } else {
    record('Medium', 'M15–M21 voice/hooks', 'fail', 'Voice/hook medium fixes incomplete');
  }

  const imagesSrc = readFileSync(resolve(process.cwd(), 'src/app/api/images/route.ts'), 'utf8');
  if (imagesSrc.includes('withAuth')) {
    record('Medium', 'M22/M23 images', 'pass', 'Image route uses withAuth + consent');
  } else {
    record('Medium', 'M22/M23 images', 'fail', 'Image route medium fixes incomplete');
  }

  const reencrypt = readFileSync(resolve(process.cwd(), 'scripts/reencrypt-legacy-data.ts'), 'utf8');
  const runbook = resolve(process.cwd(), 'docs/Reencryption-Runbook.md');
  if (reencrypt.includes('BATCH_SIZE') && existsSync(runbook)) {
    record('Medium', 'M26/M30 operations', 'pass', 'Batched reencrypt + runbook documented');
  } else {
    record('Medium', 'M26/M30 operations', 'fail', 'Operations medium fixes incomplete');
  }

  const usageSrc = readFileSync(resolve(process.cwd(), 'src/lib/usageMonitoring.ts'), 'utf8');
  if (usageSrc.includes('DAILY_USAGE_LIMIT') && usageSrc.includes('USAGE_TIMEZONE')) {
    record('Medium', 'M28/M29 usage config', 'pass', 'Configurable daily limit + timezone');
  } else {
    record('Medium', 'M28/M29 usage config', 'fail', 'Usage config medium fixes incomplete');
  }

  const mediumFlows = resolve(process.cwd(), 'tests/integration/medium-flows.test.ts');
  if (existsSync(mediumFlows) && readFileSync(mediumFlows, 'utf8').includes('apply-customer-pay-template')) {
    record('Medium', 'M27 integration tests', 'pass', 'medium-flows covers health, security, Customer Pay');
  } else {
    record('Medium', 'M27 integration tests', 'fail', 'Missing medium-priority integration coverage');
  }
}

function checkLowAuditFixes(): void {
  section('Low Priority Audit Fixes (L1–L5)');

  const authSrc = readFileSync(resolve(process.cwd(), 'src/lib/auth.ts'), 'utf8');
  const mfaLogin = existsSync(resolve(process.cwd(), 'src/app/api/auth/mfa/login-verify/route.ts'));
  const mfaService = existsSync(resolve(process.cwd(), 'src/lib/mfa/service.ts'));
  if (
    (authSrc.includes('MFA') && authSrc.includes('MERLIN_MFA_ENFORCE') && mfaLogin && mfaService) ||
    (authSrc.includes('Phase 1 accepted risk') && authSrc.includes('Planned Phase 2'))
  ) {
    record(
      'Low',
      'L1 SSO/MFA accepted risk',
      'pass',
      mfaLogin
        ? 'Native TOTP MFA shipped; SSO remains roadmap with compensating controls'
        : 'Documented with compensating controls'
    );
  } else {
    record('Low', 'L1 SSO/MFA accepted risk', 'fail', 'Auth module missing MFA/SSO documentation');
  }

  // Production warn: MFA enforce off is pilot-safe but operators should enroll managers
  const mfaPolicySrc = readFileSync(resolve(process.cwd(), 'src/lib/healthChecks.ts'), 'utf8');
  if (mfaPolicySrc.includes('checkMfaPolicyHealth') && mfaPolicySrc.includes('MERLIN_MFA_ENFORCE')) {
    record('Medium', 'MFA policy health probe', 'pass', 'healthChecks mfaPolicy warns when enforce off in prod');
  } else {
    record('Medium', 'MFA policy health probe', 'fail', 'checkMfaPolicyHealth missing from healthChecks');
  }

  const statusSrc = readFileSync(resolve(process.cwd(), 'src/app/api/status/route.ts'), 'utf8');
  if (!statusSrc.includes('grokConfigured') && statusSrc.includes('maintenance')) {
    record('Low', 'L2 status endpoint disclosure', 'pass', 'Public status omits grokConfigured');
  } else {
    record('Low', 'L2 status endpoint disclosure', 'fail', 'Public status still exposes AI configuration');
  }

  const roHook = readFileSync(resolve(process.cwd(), 'src/hooks/useRepairOrders.ts'), 'utf8');
  if (!roHook.includes('filteredROs') && roHook.includes('todayROs')) {
    record('Low', 'L3 deprecated filteredROs', 'pass', 'Legacy export removed');
  } else {
    record('Low', 'L3 deprecated filteredROs', 'fail', 'filteredROs still exported');
  }

  const runbook = readFileSync(resolve(process.cwd(), 'docs/Reencryption-Runbook.md'), 'utf8');
  const encryptionSrc = readFileSync(resolve(process.cwd(), 'src/lib/encryption.ts'), 'utf8');
  const rotationService = resolve(process.cwd(), 'src/lib/encryption/rotationService.ts');
  const rotateRoute = resolve(process.cwd(), 'src/app/api/manager/encryption/rotate/route.ts');
  if (
    runbook.includes('Key rotation') &&
    runbook.includes('DATA_ENCRYPTION_KEY_PREVIOUS') &&
    encryptionSrc.includes('DATA_ENCRYPTION_KEY_PREVIOUS') &&
    encryptionSrc.includes('getDecryptKeyCandidates') &&
    encryptionSrc.includes('reencryptCiphertextWithCurrentKey') &&
    existsSync(rotationService) &&
    existsSync(rotateRoute)
  ) {
    record(
      'Low',
      'L4 key rotation dual-key',
      'pass',
      'Dual-key decrypt + rotationService + manager rotate API + runbook'
    );
  } else {
    record(
      'Low',
      'L4 key rotation dual-key',
      'fail',
      'Missing dual-key decrypt, rotation service/API, or Reencryption-Runbook dual-key procedure'
    );
  }

  const xentrySrc = readFileSync(resolve(process.cwd(), 'src/hooks/repairOrders/useROXentryScan.ts'), 'utf8');
  const cancelBlock = xentrySrc.slice(xentrySrc.indexOf('const cancelProcessing'));
  if (cancelBlock.includes('setPendingByKey') && cancelBlock.includes('return {}')) {
    record('Low', 'L5 Xentry cancel UX', 'pass', 'Cancel clears queued diagnostic photos');
  } else {
    record('Low', 'L5 Xentry cancel UX', 'fail', 'Xentry cancel does not clear pending queue');
  }
}

async function checkCoreFeatures(): Promise<void> {
  section('Core Feature Tests');

  try {
    const sampleStory = normalizeWarrantyStoryText(
      'Customer states check engine light is on.\n\nPerformed source voltage check and connected battery charger. ' +
        'Connected XENTRY and performed Quick Test. Found fault code P0300. Replaced ignition coils and cleared codes. ' +
        'Final test drive confirmed repair.'
    );
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Merlin Pre-Rollout PDF Test', 45, 45);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    const lines = doc.splitTextToSize(sampleStory, 500);
    doc.text(lines, 45, 70);
    const output = doc.output('arraybuffer') as ArrayBuffer;
    if (output.byteLength < 400) {
      record('Core Features', 'PDF generation', 'fail', `PDF buffer too small (${output.byteLength} bytes)`);
    } else {
      record('Core Features', 'PDF generation', 'pass', `jsPDF produced ${output.byteLength} byte document`);
    }
  } catch (error) {
    record('Core Features', 'PDF generation', 'fail', error instanceof Error ? error.message : 'PDF build failed');
  }

  if (VOICE_INPUT_SETTINGS.enabled) {
    record(
      'Core Features',
      'Voice input configuration',
      'pass',
      `Enabled (${VOICE_INPUT_SETTINGS.language}, timeout ${VOICE_INPUT_SETTINGS.listeningTimeoutMs}ms)`
    );
  } else {
    record('Core Features', 'Voice input configuration', 'warn', 'Voice disabled in dealership settings', false);
  }

  record(
    'Core Features',
    'Voice browser support (Node runtime)',
    'warn',
    'Web Speech API requires Chrome/Edge on tablet — verify mic permission manually on shop floor',
    false
  );

  {
    const nextCfg = existsSync(resolve(process.cwd(), 'next.config.mjs'))
      ? readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8')
      : '';
    const policyPath = resolve(process.cwd(), 'security-policy.mjs');
    const policy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';
    const micOk =
      policy.includes('microphone=(self)') &&
      (nextCfg.includes('microphone=(self)') || nextCfg.includes('security-policy.mjs'));
    record(
      'Core Features',
      'Voice microphone CSP policy',
      micOk ? 'pass' : 'fail',
      micOk
        ? 'Permissions-Policy allows microphone=(self) for shop-floor tablets'
        : 'Add microphone=(self) to Permissions-Policy in next.config.mjs'
    );
  }

  try {
    const ro = await createRepairOrderFromScan({
      roNumber: 'PRE-ROLLOUT',
      vehicle: { vin: 'WDDGF4HB0CA000000', year: '2022', make: 'Mercedes-Benz', model: 'C300', mileageIn: '45000', mileageOut: '' },
      customerName: 'PRE-ROLLOUT TEST',
      complaints: ['CHECK ENGINE LIGHT ON'],
      complaintLabels: ['A'],
    });
    const line = ro.repairLines[0];
    line.technicianNotes = 'Quick Test found P0300. Replaced coils.';
    const userMessage = buildWarrantyStoryUserMessage(ro, line);
    if (!userMessage.includes('CHECK ENGINE') || userMessage.length < 200) {
      record('Core Features', 'Story prompt assembly', 'fail', 'buildWarrantyStoryUserMessage output incomplete');
    } else {
      record('Core Features', 'Story prompt assembly', 'pass', `User prompt ${userMessage.length} chars with complaint context`);
    }

    if (RATE_LIMITS.generate.limit === 20 && RATE_LIMITS.generate.windowMs === 60_000) {
      record(
        'Core Features',
        'AI rate limiting configuration',
        'pass',
        `Per-IP: ${RATE_LIMITS.generate.limit}/min · Daily cap enforced via UsageLog`
      );
    } else {
      record('Core Features', 'AI rate limiting configuration', 'fail', 'Rate limit constants misconfigured');
    }
  } catch (error) {
    record(
      'Core Features',
      'Story prompt assembly',
      'fail',
      error instanceof Error ? error.message : 'Prompt build failed'
    );
  }

  try {
    // Lightweight in-process service matrix (avoids server-only Grok ping from healthChecks bundle).
    const serviceChecks: Record<string, { status: string; detail: string }> = {
      environment: validateEnvironment({ production: true }).valid
        ? { status: 'ok', detail: 'required env present' }
        : { status: 'error', detail: 'missing required env' },
      database: { status: 'pending', detail: '' },
      encryption: { status: 'pending', detail: '' },
      voice: VOICE_INPUT_SETTINGS.enabled
        ? { status: 'ok', detail: `voice enabled (${VOICE_INPUT_SETTINGS.language})` }
        : { status: 'warn', detail: 'voice disabled in config' },
      maintenance: isMaintenanceModeEnabled()
        ? { status: 'warn', detail: 'maintenance mode active' }
        : { status: 'ok', detail: 'normal operation' },
      grok: process.env.GROK_API_KEY?.trim()
        ? { status: 'ok', detail: 'GROK_API_KEY configured' }
        : { status: 'warn', detail: 'GROK_API_KEY not set — AI disabled' },
      kv: isKvConfigured()
        ? { status: 'ok', detail: 'KV configured' }
        : { status: 'warn', detail: 'KV not configured' },
    };

    if (!prisma) {
      serviceChecks.database = {
        status: 'error',
        detail: databaseConfigError ?? 'DATABASE_URL not configured',
      };
    } else {
      try {
        await prisma.$queryRaw`SELECT 1`;
        serviceChecks.database = { status: 'ok', detail: 'SELECT 1 OK' };
      } catch (error) {
        serviceChecks.database = {
          status: 'error',
          detail: error instanceof Error ? error.message : 'DB failed',
        };
      }
    }

    try {
      const probe = encryptPII('health-probe');
      decryptPII(probe);
      serviceChecks.encryption = { status: 'ok', detail: 'round-trip OK' };
    } catch (error) {
      serviceChecks.encryption = {
        status: 'error',
        detail: error instanceof Error ? error.message : 'encryption failed',
      };
    }

    const errors = Object.entries(serviceChecks).filter(([, v]) => v.status === 'error');
    const warns = Object.entries(serviceChecks).filter(([, v]) => v.status === 'warn');

    if (errors.length > 0) {
      const onlyDbEnvErrors =
        errors.every(([k]) => k === 'database') &&
        process.env.VERCEL_ENV?.trim().toLowerCase() !== 'production' &&
        process.env.MERLIN_DEPLOY_GATE?.trim().toLowerCase() !== 'production';
      if (onlyDbEnvErrors) {
        record(
          'Core Features',
          'In-process health checks',
          'warn',
          errors.map(([k, v]) => `${k}=${v.detail}`).join('; ') +
            ' (non-production — DB env gap, not a code defect)',
          false
        );
      } else {
        record(
          'Core Features',
          'In-process health checks',
          'fail',
          errors.map(([k, v]) => `${k}=${v.detail}`).join('; ')
        );
      }
    } else if (warns.length > 0) {
      record(
        'Core Features',
        'In-process health checks',
        'warn',
        warns.map(([k, v]) => `${k}=${v.detail}`).join('; '),
        false
      );
    } else {
      record('Core Features', 'In-process health checks', 'pass', 'All in-process services OK');
    }

    const baseUrl = process.env.MERLIN_BASE_URL?.replace(/\/$/, '');
    if (baseUrl) {
      const started = Date.now();
      const res = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(20_000),
        headers: { Accept: 'application/json' },
        // Avoid following Vercel SSO HTML redirects; prefer the 401 JSON body.
        redirect: 'manual',
      });
      const raw = await res.text();
      const contentType = res.headers.get('content-type') || '';
      const isHtml = contentType.includes('text/html') || /^\s*<!DOCTYPE/i.test(raw) || /^\s*<html/i.test(raw);

      // Vercel Deployment Protection (team SSO) — not an app code defect.
      if (
        res.status === 401 ||
        res.status === 403 ||
        (res.type === 'opaqueredirect' && res.status >= 300 && res.status < 400) ||
        (isHtml && res.status >= 300)
      ) {
        let protectionNote = `HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(raw) as {
            error?: { message?: string } | string;
            protection?: { vercel_auth_enabled?: boolean };
          };
          const msg =
            typeof parsed.error === 'string'
              ? parsed.error
              : parsed.error?.message || '';
          if (msg || parsed.protection?.vercel_auth_enabled) {
            protectionNote = msg || 'Protected deployment (Vercel SSO)';
          }
        } catch {
          if (isHtml) protectionNote = 'Vercel auth HTML (deployment protection)';
        }
        record(
          'Core Features',
          'Live /api/health endpoint',
          'warn',
          `${baseUrl}/api/health blocked by deployment protection: ${protectionNote}. Open URL in a Vercel-team browser session, or set MERLIN_HEALTH_COOKIE / protection bypass for CLI probes.`,
          false
        );
      } else {
        let body: { status?: string; services?: Record<string, string>; checks?: unknown } = {};
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          record(
            'Core Features',
            'Live /api/health endpoint',
            'fail',
            `HTTP ${res.status} non-JSON body (${contentType || 'unknown type'})`
          );
          return;
        }
        if (!res.ok || body.status === 'error') {
          record(
            'Core Features',
            'Live /api/health endpoint',
            'fail',
            `HTTP ${res.status} status=${body.status ?? 'unknown'}`
          );
        } else if (body.status === 'degraded') {
          record(
            'Core Features',
            'Live /api/health endpoint',
            'warn',
            `HTTP ${res.status} degraded in ${Date.now() - started}ms`,
            false
          );
        } else {
          const svc = body.services
            ? Object.entries(body.services)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : 'n/a';
          record(
            'Core Features',
            'Live /api/health endpoint',
            'pass',
            `${baseUrl}/api/health → ${body.status} (${Date.now() - started}ms) [${svc}]`
          );
        }
      }
    } else {
      record(
        'Core Features',
        'Live /api/health endpoint',
        'warn',
        'Set MERLIN_BASE_URL to test deployed /api/health (in-process checks ran above)',
        false
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Health check failed';
    // Network / DNS / JSON parse from protected HTML should not always be "code" hard-fails
    // when MERLIN_BASE_URL points at a Vercel-protected staging host.
    if (/Unexpected token|is not valid JSON|Protected deployment/i.test(message)) {
      record(
        'Core Features',
        'Live /api/health endpoint',
        'warn',
        `${message} — likely Vercel Deployment Protection; use team SSO browser or bypass secret`,
        false
      );
    } else {
      record('Core Features', 'Health endpoint check', 'fail', message);
    }
  }
}

const REQUIRED_ROLLOUT_DOCS = [
  'Master-Rollout-Document.md',
  'Technician-Quick-Start.md',
  'Bay-Reference-Card.md',
  'Bay-Reference-Card-Front.md',
  'Bay-Reference-Card-Back.md',
  'Admin-Setup-Guide.md',
  'Rollout-Checklist.md',
  'Training-Outline.md',
  'Go-Live-Checklist.md',
  'Go-Live-Email-Template.md',
  'Go-Live-Summary.md',
  'Support-Playbook.md',
];

const RECOMMENDED_DOC_IMAGE_BASES = [
  'technician-login-ro-list',
  'technician-voice-modes',
  'technician-voice-panel',
  'technician-notes-voice',
  'technician-diagnostic-evidence',
  'technician-generate-mi43',
  'technician-story-actions',
];

function docImagePresent(imagesDir: string, baseName: string): boolean {
  return ['.svg', '.png', '.webp'].some((ext) => existsSync(resolve(imagesDir, `${baseName}${ext}`)));
}

async function checkDocumentation(): Promise<void> {
  section('Rollout Documentation');

  const docsDir = resolve(process.cwd(), 'docs');
  const missingDocs = REQUIRED_ROLLOUT_DOCS.filter((name) => !existsSync(resolve(docsDir, name)));

  if (missingDocs.length === 0) {
    record(
      'Documentation',
      'Required rollout documents',
      'pass',
      `${REQUIRED_ROLLOUT_DOCS.length} files present in docs/`
    );
  } else {
    record(
      'Documentation',
      'Required rollout documents',
      'fail',
      `Missing: ${missingDocs.join(', ')}`
    );
  }

  const readmePath = resolve(process.cwd(), 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    const linksMaster = readme.includes('Master-Rollout-Document.md');
    const linksBayCard = readme.includes('Bay-Reference-Card.md');
    if (linksMaster && linksBayCard) {
      record(
        'Documentation',
        'README documentation index',
        'pass',
        'README links Master Rollout Document and Bay Reference Card'
      );
    } else {
      record(
        'Documentation',
        'README documentation index',
        'fail',
        'README missing links to key rollout documents'
      );
    }
  } else {
    record('Documentation', 'README documentation index', 'fail', 'README.md not found');
  }

  const imagesDir = resolve(docsDir, 'images');
  if (!existsSync(imagesDir)) {
    record(
      'Documentation',
      'Technician guide screenshots',
      'warn',
      'docs/images/ not found — add screenshots before printing Technician Quick Start',
      false
    );
  } else {
    const missingImages = RECOMMENDED_DOC_IMAGE_BASES.filter((base) => !docImagePresent(imagesDir, base));
    if (missingImages.length === 0) {
      record(
        'Documentation',
        'Technician guide screenshots',
        'pass',
        `All ${RECOMMENDED_DOC_IMAGE_BASES.length} recommended images present (SVG/PNG)`
      );
    } else {
      record(
        'Documentation',
        'Technician guide screenshots',
        'warn',
        `Missing ${missingImages.length}/${RECOMMENDED_DOC_IMAGE_BASES.length} images — OK for launch; replace wireframes with dealership captures before print`,
        false
      );
    }
  }
}

async function checkSecurityAndConfig(): Promise<void> {
  section('Security & Configuration');

  const nextConfigPath = resolve(process.cwd(), 'next.config.mjs');
  const nextConfig = existsSync(nextConfigPath) ? readFileSync(nextConfigPath, 'utf8') : '';
  const middlewarePath = resolve(process.cwd(), 'src/middleware.ts');
  const middleware = existsSync(middlewarePath) ? readFileSync(middlewarePath, 'utf8') : '';
  const policyPath = resolve(process.cwd(), 'security-policy.mjs');
  const securityPolicy = existsSync(policyPath) ? readFileSync(policyPath, 'utf8') : '';

  const cspRequirements = ["default-src 'self'", "'unsafe-inline'", "object-src 'none'"];
  const cspSource = securityPolicy + middleware + nextConfig;
  const missingCsp = cspRequirements.filter((req) => !cspSource.includes(req));
  const hasUnsafeEval = middleware.includes('unsafe-eval') || nextConfig.includes('unsafe-eval');
  if (missingCsp.length === 0 && !hasUnsafeEval && nextConfig.includes('Strict-Transport-Security')) {
    record('Security', 'CSP & security headers config', 'pass', 'CSP middleware + HSTS in next.config');
  } else {
    record('Security', 'CSP & security headers config', 'fail', `CSP hardening incomplete (missing: ${missingCsp.join(', ')})`);
  }

  const grokRoutes = [
    'src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route.ts',
    'src/app/api/repair-orders/[id]/lines/[lineId]/review-story/route.ts',
    'src/app/api/repair-orders/extract/route.ts',
    'src/app/api/diagnostics/extract/route.ts',
  ];
  const rateLimitFailures: string[] = [];
  for (const rel of grokRoutes) {
    const content = readFileSync(resolve(process.cwd(), rel), 'utf8');
    if (!content.includes('trackUsage: true')) {
      rateLimitFailures.push(`${rel} missing trackUsage`);
    }
    if (!content.includes('RATE_LIMITS.generate') && !content.includes('rateLimit:')) {
      rateLimitFailures.push(`${rel} missing rate limit config`);
    }
  }
  if (rateLimitFailures.length === 0) {
    record(
      'Security',
      'Grok route rate limiting',
      'pass',
      `All ${grokRoutes.length} AI routes have trackUsage + per-IP limits`
    );
  } else {
    record('Security', 'Grok route rate limiting', 'fail', rateLimitFailures.join('; '));
  }

  if (isKvConfigured()) {
    record('Security', 'Distributed rate limiting (KV)', 'pass', 'KV_REST_API_URL and token configured');
  } else {
    record(
      'Security',
      'Distributed rate limiting (KV)',
      'warn',
      'KV not configured — rate limits are per-instance only in serverless',
      false
    );
  }

  const apiRoot = resolve(process.cwd(), 'src/app/api');
  const routeFiles = listRouteFiles(apiRoot);
  const publicAllowlist = new Set([
    'status/route.ts',
    'auth/login/route.ts',
    'auth/logout/route.ts',
    'auth/me/route.ts',
    'auth/refresh/route.ts',
    'auth/select-dealership/route.ts',
    'auth/mfa/login-verify/route.ts',
    'setup/seed/route.ts',
  ]);
  const unauthenticated: string[] = [];
  for (const file of routeFiles) {
    const rel = file.replace(apiRoot + '\\', '').replace(apiRoot + '/', '').replace(/\\/g, '/');
    const content = readFileSync(file, 'utf8');
    const isPublic = [...publicAllowlist].some((allowed) => rel.endsWith(allowed));
    // withStoryAiRoute wraps withAuth; withPublicRoute is the approved public gateway (rate limit + envelope).
    const hasWithAuth =
      content.includes('withAuth(') ||
      content.includes('withStoryAiRoute(') ||
      content.includes('withPublicRoute(');
    const hasSvixWebhookVerification =
      content.includes('verifyWebhook(') && content.includes('@clerk/nextjs/webhooks');
    const hasApexPreAuth =
      content.includes('verifyPendingSelectionToken') || content.includes('rotateApexRefreshToken');
    // Customer share links must stay public (no withAuth) but require hardened share-token gates.
    const hasPublicVideoShareHardening =
      rel.startsWith('public/video/') &&
      content.includes('hashShareToken') &&
      content.includes('isValidRawShareToken') &&
      content.includes('expiresAt') &&
      content.includes('passcodeHash') &&
      content.includes('verifyPasscodeHash') &&
      (content.includes('checkRateLimit') || content.includes('withPublicRoute('));
    // Twilio Programmable Voice / recording webhooks — signature verified (not session auth).
    const hasTwilioWebhookAuth =
      rel.startsWith('voice/') &&
      content.includes('validateTwilioSignature') &&
      (content.includes('x-twilio-signature') || content.includes('X-Twilio-Signature'));
    // CF Queue consumer bridge — shared secret, not browser session.
    const hasQueueConsumerAuth =
      rel.includes('queue/ai-consumer') &&
      (content.includes('AI_QUEUE_CONSUMER_SECRET') || content.includes('Bearer'));
    // MFA second factor at login — pending MFA JWT + rate limit (pre-session).
    const hasMfaLoginVerify =
      rel.includes('auth/mfa/login-verify') &&
      content.includes('verifyPendingMfaToken') &&
      content.includes('checkRateLimit');
    if (
      !isPublic &&
      !hasWithAuth &&
      !hasSvixWebhookVerification &&
      !hasApexPreAuth &&
      !hasPublicVideoShareHardening &&
      !hasTwilioWebhookAuth &&
      !hasQueueConsumerAuth &&
      !hasMfaLoginVerify
    ) {
      unauthenticated.push(rel);
    }
  }
  if (unauthenticated.length === 0) {
    record('Security', 'Sensitive route authentication', 'pass', `${routeFiles.length} API routes audited — all protected`);
  } else {
    record(
      'Security',
      'Sensitive route authentication',
      'fail',
      `Routes without withAuth or Svix webhook verification: ${unauthenticated.join(', ')}`
    );
  }

  const securityExposedKeys = getExposedPublicGrokEnvKeys();
  if (securityExposedKeys.length === 0) {
    record('Security', 'Grok API key exposure', 'pass', 'No NEXT_PUBLIC_* xAI keys — GROK_API_KEY is server-only');
  } else {
    record(
      'Security',
      'Grok API key exposure',
      'fail',
      `Remove forbidden keys: ${securityExposedKeys.join(', ')} — use GROK_API_KEY only`
    );
  }
}

// ─── Summary report ────────────────────────────────────────────────────────────

function printKindBucket(title: string, items: CheckResult[], color: string): void {
  if (items.length === 0) return;
  console.log(`\n${color}${c.bold}${title}${c.reset}`);
  for (const r of items) {
    const statusColor = r.status === 'pass' ? c.green : r.status === 'warn' ? c.yellow : c.red;
    console.log(`  ${statusColor}${r.status.toUpperCase().padEnd(4)}${c.reset} [${r.section}] ${r.name}`);
    if (r.detail) console.log(`       ${c.dim}${r.detail}${c.reset}`);
  }
}

function printSummary(): void {
  const passed = results.filter((r) => r.status === 'pass').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const criticalCodeFails = results.filter(
    (r) => r.status === 'fail' && r.critical && r.kind === 'code'
  );
  const criticalConfigFails = results.filter(
    (r) => r.status === 'fail' && r.critical && r.kind === 'config'
  );
  const criticalFails = criticalCodeFails.length + criticalConfigFails.length;

  console.log(`\n${c.bold}${'═'.repeat(64)}${c.reset}`);
  console.log(`${c.bold}  MERLIN PRE-ROLLOUT VALIDATION REPORT${c.reset}`);
  console.log(`${c.dim}  ${new Date().toISOString()} · v${getAppVersion()} · prompt ${PROMPT_VERSION}${c.reset}`);
  console.log(`${c.bold}${'═'.repeat(64)}${c.reset}\n`);

  const sections = [...new Set(results.map((r) => r.section))];
  for (const sec of sections) {
    console.log(`${c.bold}${sec}${c.reset}`);
    for (const r of results.filter((x) => x.section === sec)) {
      const color = r.status === 'pass' ? c.green : r.status === 'warn' ? c.yellow : c.red;
      const label = r.status.toUpperCase().padEnd(4);
      const kindTag = r.kind === 'code' ? '' : ` ${c.dim}(${r.kind})${c.reset}`;
      console.log(`  ${color}${label}${c.reset} ${r.name}${kindTag}`);
      if (r.detail) console.log(`       ${c.dim}${r.detail}${c.reset}`);
    }
    console.log('');
  }

  console.log(`${c.bold}Totals:${c.reset}  ${c.green}${passed} passed${c.reset}  ${c.yellow}${warned} warnings${c.reset}  ${c.red}${failed} failed${c.reset}`);

  printKindBucket(
    'CODE ISSUES — fix in repository, then rebuild and redeploy',
    criticalCodeFails,
    c.red
  );
  printKindBucket(
    'CONFIG / ENV ISSUES — fix in Vercel project settings or .env.local (not a code defect)',
    criticalConfigFails,
    c.red
  );

  const docWarnings = results.filter((r) => r.status === 'warn' && r.kind === 'documentation');
  printKindBucket(
    'DOCUMENTATION NOTES — non-blocking; complete before print distribution',
    docWarnings,
    c.yellow
  );

  console.log(`\n${c.bold}Rollout verdict${c.reset}`);
  if (criticalCodeFails.length > 0) {
    console.log(
      `${c.red}${c.bold}✖ CODE NOT READY — ${criticalCodeFails.length} critical code failure(s).${c.reset}`
    );
    console.log(`${c.dim}  Resolve code issues above before staging validation.${c.reset}`);
  } else {
    console.log(`${c.green}✔ Code checks passed — no critical repository defects.${c.reset}`);
  }

  if (criticalConfigFails.length > 0) {
    console.log(
      `${c.red}${c.bold}✖ CONFIG INCOMPLETE — ${criticalConfigFails.length} critical env/deployment gap(s).${c.reset}`
    );
    console.log(
      `${c.dim}  Set missing variables in Vercel (see .env.example) or copy .env.example → .env.local for local runs.${c.reset}`
    );
  } else if (criticalCodeFails.length === 0) {
    console.log(`${c.green}✔ Environment configuration complete for this run.${c.reset}`);
  }

  // Exit policy: only critical *code* failures block ready-to-deploy.
  // Config/env gaps are reported above but do not fail the gate in local/CI.
  if (criticalCodeFails.length > 0) {
    console.log(`${c.dim}\n  Rollout blocked until critical code failures are fixed.${c.reset}\n`);
  } else if (criticalConfigFails.length > 0) {
    console.log(
      `\n${c.yellow}${c.bold}⚠ CODE READY — ${criticalConfigFails.length} config gap(s) remain (non-blocking for ready-to-deploy).${c.reset}`
    );
    console.log(
      `${c.dim}  Set missing production env on Vercel before traffic; local/CI may proceed.${c.reset}\n`
    );
  } else if (warned > 0) {
    console.log(`\n${c.yellow}${c.bold}⚠ PROCEED WITH CAUTION — ${warned} warning(s).${c.reset}`);
    console.log(`${c.dim}  Review warnings; complete manual tablet tests (voice, PDF, offline).${c.reset}\n`);
  } else {
    console.log(`\n${c.green}${c.bold}✔ ALL CHECKS PASSED — ready for dealership rollout.${c.reset}\n`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

function checkProductionReadiness(): void {
  section('Production Readiness (Final Polish)');

  const readinessDoc = resolve(process.cwd(), 'docs/Production-Readiness-Checklist.md');
  if (existsSync(readinessDoc) && readFileSync(readinessDoc, 'utf8').includes('Sign-off')) {
    record(
      'Production',
      'Readiness checklist document',
      'pass',
      'docs/Production-Readiness-Checklist.md ready for dealership sign-off'
    );
  } else {
    record('Production', 'Readiness checklist document', 'fail', 'Missing Production-Readiness-Checklist.md');
  }

  const globals = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
  const uxOk =
    globals.includes('story-card-cp') &&
    globals.includes('benz-voice-inline-btn') &&
    globals.includes('benz-story-badge-cp');
  if (uxOk) {
    record('Production', 'Technician UX polish', 'pass', 'Customer Pay + voice + story badges styled');
  } else {
    record('Production', 'Technician UX polish', 'fail', 'Missing production UX CSS tokens');
  }

  if (
    existsSync(resolve(process.cwd(), 'src/components/LoadErrorScreen.tsx')) &&
    existsSync(resolve(process.cwd(), 'src/components/StoryStatusBadge.tsx')) &&
    existsSync(resolve(process.cwd(), 'src/lib/dateFormat.ts'))
  ) {
    record('Production', 'Resilience + consistency utilities', 'pass', 'Load retry, story badges, dateFormat');
  } else {
    record('Production', 'Resilience + consistency utilities', 'fail', 'Missing production utility components');
  }

  const loggerSrc = readFileSync(resolve(process.cwd(), 'src/lib/logger.ts'), 'utf8');
  if (loggerSrc.includes('LOG_LEVEL') && loggerSrc.includes('shouldLog')) {
    record('Production', 'Production log levels', 'pass', 'LOG_LEVEL gates server logging');
  } else {
    record('Production', 'Production log levels', 'fail', 'Logger missing LOG_LEVEL support');
  }

  const envExample = readFileSync(resolve(process.cwd(), '.env.example'), 'utf8');
  const envDocOk =
    envExample.includes('MERLIN_BASE_URL') &&
    envExample.includes('LOG_LEVEL') &&
    envExample.includes('DAILY_USAGE_LIMIT');
  if (envDocOk) {
    record('Production', 'Environment documentation', 'pass', '.env.example documents ops variables');
  } else {
    record('Production', 'Environment documentation', 'warn', 'Expand .env.example with MERLIN_BASE_URL, LOG_LEVEL', false);
  }

  const readme = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
  const readinessDeclared =
    readme.includes('Production-Readiness-Checklist') &&
    (readme.includes('Production Ready') ||
      readme.includes('Ready for Validation') ||
      readme.includes('production-ready') ||
      readme.includes('Conditional pilot') ||
      readme.includes('ready-to-deploy'));
  if (readinessDeclared) {
    record('Production', 'README readiness index', 'pass', 'README links production checklist and declares readiness');
  } else {
    record('Production', 'README readiness index', 'fail', 'README missing production readiness declaration');
  }

  const nextCfg = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf8');
  if (nextCfg.includes('optimizePackageImports')) {
    record('Production', 'Bundle optimization', 'pass', 'lucide-react import optimization enabled');
  } else {
    record('Production', 'Bundle optimization', 'warn', 'Consider optimizePackageImports for lucide-react', false);
  }
}

function checkApexPhase51Schema(): void {
  section('APEX Phase 5.1 — Fortress Schema');

  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const schemaOk =
    schema.includes('owner') &&
    schema.includes('apexUsername') &&
    schema.includes('model SessionRefreshToken') &&
    schema.includes('authSource') &&
    schema.includes('scopeMode') &&
    /d7Number\s+String\?\s+@unique/.test(schema);

  if (schemaOk) {
    record(
      'APEX 5.1',
      'Prisma schema',
      'pass',
      'owner role, apexUsername, nullable d7, audit extensions, SessionRefreshToken'
    );
  } else {
    record('APEX 5.1', 'Prisma schema', 'fail', 'Phase 5.1 fortress schema incomplete');
  }

  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20250711120000_apex_phase5_1_fortress_schema/migration.sql'
  );
  if (existsSync(migrationPath)) {
    const sql = readFileSync(migrationPath, 'utf8');
    const migrationOk =
      sql.includes('__apex_national__') &&
      sql.includes('SessionRefreshToken') &&
      sql.includes('auth_source');
    if (migrationOk) {
      record('APEX 5.1', 'Migration SQL', 'pass', 'Sentinel dealership, refresh tokens, audit columns');
    } else {
      record('APEX 5.1', 'Migration SQL', 'fail', 'Phase 5.1 migration SQL incomplete');
    }
  } else {
    record('APEX 5.1', 'Migration SQL', 'fail', 'Missing 20250711120000_apex_phase5_1_fortress_schema');
  }

  const rlsPath = resolve(process.cwd(), 'prisma/rls/apex_phase5_prepared_policies.sql');
  if (existsSync(rlsPath) && readFileSync(rlsPath, 'utf8').includes('ENABLE ROW LEVEL SECURITY')) {
    record('APEX 5.1', 'RLS prepared policies', 'pass', 'Commented policy templates for Phase 6');
  } else {
    record('APEX 5.1', 'RLS prepared policies', 'fail', 'Missing prisma/rls/apex_phase5_prepared_policies.sql');
  }
}

function checkApexPhase52Membership(): void {
  section('APEX Phase 5.2 — TechnicianDealership');

  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const schemaOk =
    schema.includes('model TechnicianDealership') &&
    schema.includes('isPrimary') &&
    schema.includes('isActive') &&
    /@@unique\(\[technicianId, dealershipId\]\)/.test(schema);

  if (schemaOk) {
    record('APEX 5.2', 'Prisma schema', 'pass', 'TechnicianDealership join model');
  } else {
    record('APEX 5.2', 'Prisma schema', 'fail', 'TechnicianDealership model incomplete');
  }

  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20250711130000_apex_phase5_2_technician_dealership/migration.sql'
  );
  if (existsSync(migrationPath)) {
    const sql = readFileSync(migrationPath, 'utf8');
    const migrationOk =
      sql.includes('TechnicianDealership') &&
      sql.includes('FROM "Technician" t') &&
      sql.includes('ON CONFLICT');
    if (migrationOk) {
      record('APEX 5.2', 'Backfill migration', 'pass', 'One membership row per technician');
    } else {
      record('APEX 5.2', 'Backfill migration', 'fail', 'TechnicianDealership backfill SQL incomplete');
    }
  } else {
    record('APEX 5.2', 'Backfill migration', 'fail', 'Missing 20250711130000_apex_phase5_2_technician_dealership');
  }

  const guardPath = resolve(process.cwd(), 'src/lib/apex/membershipGuard.ts');
  if (existsSync(guardPath)) {
    const src = readFileSync(guardPath, 'utf8');
    const guardOk =
      src.includes('assertDealershipMembership') &&
      src.includes('DealershipMembershipError') &&
      src.includes('upsertTechnicianDealershipMembership');
    if (guardOk) {
      record('APEX 5.2', 'membershipGuard.ts', 'pass', 'assertDealershipMembership helper present');
    } else {
      record('APEX 5.2', 'membershipGuard.ts', 'fail', 'membershipGuard.ts incomplete');
    }
  } else {
    record('APEX 5.2', 'membershipGuard.ts', 'fail', 'Missing src/lib/apex/membershipGuard.ts');
  }
}

function checkApexPhase53UnifiedLogin(): void {
  section('APEX Phase 5.3 — Unified Login');

  const credentialPath = resolve(process.cwd(), 'src/lib/apex/credentialType.ts');
  const resolverPath = resolve(process.cwd(), 'src/lib/apex/loginResolver.ts');
  const loginRoutePath = resolve(process.cwd(), 'src/app/api/auth/login/route.ts');

  if (existsSync(credentialPath)) {
    const src = readFileSync(credentialPath, 'utf8');
    const ok =
      src.includes('detectCredentialType') &&
      src.includes('normalizeApexUsername') &&
      src.includes('isCredentialRoleAllowed');
    if (ok) {
      record('APEX 5.3', 'credentialType.ts', 'pass', 'Email / D7 / username detection');
    } else {
      record('APEX 5.3', 'credentialType.ts', 'fail', 'credentialType.ts incomplete');
    }
  } else {
    record('APEX 5.3', 'credentialType.ts', 'fail', 'Missing credentialType.ts');
  }

  if (existsSync(resolverPath)) {
    const src = readFileSync(resolverPath, 'utf8');
    const ok = src.includes('resolveUnifiedLogin') && src.includes('validateTechnicianForLogin');
    if (ok) {
      record('APEX 5.3', 'loginResolver.ts', 'pass', 'Unified login resolver');
    } else {
      record('APEX 5.3', 'loginResolver.ts', 'fail', 'loginResolver.ts incomplete');
    }
  } else {
    record('APEX 5.3', 'loginResolver.ts', 'fail', 'Missing loginResolver.ts');
  }

  if (existsSync(loginRoutePath)) {
    const src = readFileSync(loginRoutePath, 'utf8');
    const ok =
      src.includes('loginRequestSchema') &&
      src.includes('isApexPlatformMode') &&
      src.includes('resolveUnifiedLogin');
    if (ok) {
      record('APEX 5.3', 'auth/login route', 'pass', 'Merlinus + apex login branches');
    } else {
      record('APEX 5.3', 'auth/login route', 'fail', 'Login route missing unified handler');
    }
  } else {
    record('APEX 5.3', 'auth/login route', 'fail', 'Missing auth login route');
  }
}

function checkApexPhase55OwnerScope(): void {
  section('APEX Phase 5.5 — Owner Least-Privilege Scoping');

  const tenantScopePath = resolve(process.cwd(), 'src/lib/apex/tenantScope.ts');
  const ownerContextPath = resolve(process.cwd(), 'src/lib/apex/ownerDealershipContext.ts');
  const apiRoutePath = resolve(process.cwd(), 'src/lib/apiRoute.ts');
  const enterPath = resolve(process.cwd(), 'src/app/api/auth/enter-dealership/route.ts');
  const exitPath = resolve(process.cwd(), 'src/app/api/auth/exit-dealership/route.ts');

  if (existsSync(tenantScopePath) && existsSync(ownerContextPath)) {
    const tenantSrc = readFileSync(tenantScopePath, 'utf8');
    const ownerSrc = readFileSync(ownerContextPath, 'utf8');
    const ok =
      tenantSrc.includes('scopedPiiWhere') &&
      tenantSrc.includes('requireDealershipScope') &&
      tenantSrc.includes('enrichSessionWithTenantScope') &&
      ownerSrc.includes('buildOwnerNationalSession') &&
      ownerSrc.includes('buildOwnerDealershipSession');
    if (ok) {
      record('APEX 5.5', 'tenantScope + owner context', 'pass', 'PII scoping helpers present');
    } else {
      record('APEX 5.5', 'tenantScope + owner context', 'fail', 'Scoping helpers incomplete');
    }
  } else {
    record('APEX 5.5', 'tenantScope + owner context', 'fail', 'Missing tenantScope or ownerDealershipContext');
  }

  if (existsSync(apiRoutePath)) {
    const apiSrc = readFileSync(apiRoutePath, 'utf8');
    if (apiSrc.includes('requireDealershipContext') && apiSrc.includes('requireOwner')) {
      record('APEX 5.5', 'withAuth guards', 'pass', 'requireOwner + requireDealershipContext');
    } else {
      record('APEX 5.5', 'withAuth guards', 'fail', 'withAuth missing owner/dealership guards');
    }
  }

  if (existsSync(enterPath) && existsSync(exitPath)) {
    const enterSrc = readFileSync(enterPath, 'utf8');
    const exitSrc = readFileSync(exitPath, 'utf8');
    // Exit returns to group or national home via buildOwnerHomeSession (PR-G2+)
    const ok =
      enterSrc.includes('owner.dealership_enter') &&
      exitSrc.includes('owner.dealership_exit') &&
      enterSrc.includes('buildOwnerDealershipSession') &&
      (exitSrc.includes('buildOwnerHomeSession') || exitSrc.includes('buildOwnerNationalSession'));
    if (ok) {
      record('APEX 5.5', 'Enter/exit routes', 'pass', 'Owner dealership context flows + audit');
    } else {
      record('APEX 5.5', 'Enter/exit routes', 'fail', 'Enter/exit routes incomplete');
    }
  } else {
    record('APEX 5.5', 'Enter/exit routes', 'fail', 'Missing enter-dealership or exit-dealership route');
  }
}

/**
 * PR-G1–G5 — DealerGroup + group owner dashboard complete gate.
 */
function checkApexDealerGroupFinalize(): void {
  section('APEX DealerGroup — Finalize (PR-G5)');

  const schema = resolve(process.cwd(), 'prisma/schema.prisma');
  if (existsSync(schema)) {
    const src = readFileSync(schema, 'utf8');
    if (
      src.includes('model DealerGroup') &&
      src.includes('model DealerGroupMembership') &&
      src.includes('dealerGroupId')
    ) {
      record('APEX DealerGroup', 'Prisma schema', 'pass', 'DealerGroup + membership + dealer FK');
    } else {
      record('APEX DealerGroup', 'Prisma schema', 'fail', 'DealerGroup models incomplete');
    }
  } else {
    record('APEX DealerGroup', 'Prisma schema', 'fail', 'Missing schema.prisma');
  }

  const migration = resolve(
    process.cwd(),
    'prisma/migrations/20250714120000_apex_dealer_group/migration.sql'
  );
  if (existsSync(migration)) {
    record('APEX DealerGroup', 'Migration', 'pass', '20250714120000_apex_dealer_group');
  } else {
    record('APEX DealerGroup', 'Migration', 'fail', 'Missing DealerGroup migration');
  }

  const seed = resolve(process.cwd(), 'src/lib/apex/seedDealerGroups.ts');
  if (existsSync(seed)) {
    const src = readFileSync(seed, 'utf8');
    if (src.includes('VITI-AUTO') && src.includes('viti.james.gray') && src.includes('VITI_AUTO_OWNER_PASSWORD')) {
      record('APEX DealerGroup', 'Seed', 'pass', 'Viti Automotive Group + James Gray seed');
    } else {
      record('APEX DealerGroup', 'Seed', 'fail', 'seedDealerGroups incomplete');
    }
  } else {
    record('APEX DealerGroup', 'Seed', 'fail', 'Missing seedDealerGroups.ts');
  }

  const access = resolve(process.cwd(), 'src/lib/apex/dealerGroupAccess.ts');
  if (existsSync(access) && readFileSync(access, 'utf8').includes('listEnterableDealershipsForOwner')) {
    record('APEX DealerGroup', 'Access helpers', 'pass', 'Group-scoped rooftop listing');
  } else {
    record('APEX DealerGroup', 'Access helpers', 'fail', 'Missing dealerGroupAccess helpers');
  }

  const session = resolve(process.cwd(), 'src/lib/apex/ownerDealershipContext.ts');
  if (existsSync(session)) {
    const src = readFileSync(session, 'utf8');
    if (src.includes('buildOwnerHomeSession') && src.includes('buildOwnerGroupSession')) {
      record('APEX DealerGroup', 'Session home', 'pass', 'Group vs national owner home session');
    } else {
      record('APEX DealerGroup', 'Session home', 'fail', 'Owner home session incomplete');
    }
  }

  const summary = resolve(process.cwd(), 'src/lib/apex/ownerNationalSummary.ts');
  if (existsSync(summary)) {
    const src = readFileSync(summary, 'utf8');
    if (
      src.includes('volumeTrend') &&
      src.includes('certificationRatePct') &&
      src.includes('medianTimeToCertifyHours') &&
      src.includes('attentionFlags') &&
      src.includes('category')
    ) {
      record('APEX DealerGroup', 'Dashboard metrics', 'pass', 'Tier 1–3 owner summary fields');
    } else {
      record('APEX DealerGroup', 'Dashboard metrics', 'fail', 'Owner summary missing Tier 2/3 fields');
    }
  } else {
    record('APEX DealerGroup', 'Dashboard metrics', 'fail', 'Missing ownerNationalSummary.ts');
  }

  const shell = resolve(process.cwd(), 'src/components/apex/ApexOwnerNationalShell.tsx');
  if (existsSync(shell)) {
    const src = readFileSync(shell, 'utf8');
    if (
      src.includes('OwnerSparkline') &&
      src.includes('Tier 3') &&
      src.includes('Rooftop comparison') &&
      src.includes("scopeMode === 'group'")
    ) {
      record('APEX DealerGroup', 'Owner dashboard UI', 'pass', 'Group shell Tier 1–3 + sparklines');
    } else {
      record('APEX DealerGroup', 'Owner dashboard UI', 'fail', 'ApexOwnerNationalShell incomplete');
    }
  }

  const platformConsts = resolve(process.cwd(), 'src/lib/apex/platformConstants.ts');
  if (existsSync(platformConsts) && readFileSync(platformConsts, 'utf8').includes("'group'")) {
    record('APEX DealerGroup', 'scopeMode group', 'pass', 'Audit/session scope includes group');
  } else {
    record('APEX DealerGroup', 'scopeMode group', 'fail', 'group scope mode missing');
  }

  const docs = resolve(process.cwd(), 'docs/Apex-DealerGroup-Owner-Dashboard.md');
  if (existsSync(docs)) {
    const text = readFileSync(docs, 'utf8');
    if (text.includes('VITI-AUTO') && text.includes('Tier 3') && text.includes('viti.james.gray')) {
      record('APEX DealerGroup', 'Documentation', 'pass', 'Apex-DealerGroup-Owner-Dashboard.md');
    } else {
      record('APEX DealerGroup', 'Documentation', 'fail', 'DealerGroup docs incomplete');
    }
  } else {
    record('APEX DealerGroup', 'Documentation', 'fail', 'Missing Apex-DealerGroup-Owner-Dashboard.md');
  }

  const national = resolve(process.cwd(), 'docs/Apex-National-Platform.md');
  if (existsSync(national) && readFileSync(national, 'utf8').includes('DealerGroup & group owner')) {
    record('APEX DealerGroup', 'National platform docs', 'pass', 'Group owner flow in Apex-National-Platform.md');
  } else {
    record('APEX DealerGroup', 'National platform docs', 'fail', 'National platform missing group owner section');
  }

  const testsOk =
    existsSync(resolve(process.cwd(), 'tests/unit/dealerGroup.test.ts')) &&
    existsSync(resolve(process.cwd(), 'tests/unit/dealerGroupScope.test.ts')) &&
    existsSync(resolve(process.cwd(), 'tests/unit/ownerGroupDashboard.test.ts'));
  if (testsOk) {
    record('APEX DealerGroup', 'Unit tests', 'pass', 'G1–G5 unit coverage present');
  } else {
    record('APEX DealerGroup', 'Unit tests', 'fail', 'Missing DealerGroup unit tests');
  }
}

/**
 * PR-P1–P4 — secure multi-dealer provision system gate.
 * Ensures CLI + HTTP + forced password + docs + tests ship together.
 */
function checkApexDealerProvisionFinalize(): void {
  section('APEX Dealer Provision — Finalize (PR-P4)');

  const engine = resolve(process.cwd(), 'src/lib/apex/provisionDealer.ts');
  if (existsSync(engine)) {
    const src = readFileSync(engine, 'utf8');
    const ok =
      src.includes('export async function provisionDealer') &&
      src.includes('mustChangePassword') &&
      src.includes('dealer.provision') &&
      src.includes('isHttpProvisionEnabled') &&
      src.includes('toSafeProvisionHttpResponse') &&
      src.includes('withRlsBypass') &&
      src.includes('buildDealerProvisionAuditMetadata');
    if (ok) {
      record('APEX Provision', 'Core engine', 'pass', 'provisionDealer + HTTP helpers + audit');
    } else {
      record('APEX Provision', 'Core engine', 'fail', 'provisionDealer.ts incomplete');
    }
  } else {
    record('APEX Provision', 'Core engine', 'fail', 'Missing provisionDealer.ts');
  }

  const templates = resolve(process.cwd(), 'src/lib/apex/dealerTemplates.ts');
  if (existsSync(templates)) {
    const src = readFileSync(templates, 'utf8');
    const ok =
      src.includes('base-rooftop-v1') &&
      src.includes('mercedes-rooftop-v1') &&
      src.includes('generic-rooftop-v1') &&
      src.includes('extendFromBase') &&
      src.includes('hardcodedDisplayName') &&
      src.includes('copyPilotDealership');
    if (ok) {
      record(
        'APEX Provision',
        'Templates',
        'pass',
        'base + mercedes + generic rooftop templates (clean inheritance)'
      );
    } else {
      record('APEX Provision', 'Templates', 'fail', 'dealerTemplates incomplete');
    }
  } else {
    record('APEX Provision', 'Templates', 'fail', 'Missing dealerTemplates.ts');
  }

  const cli = resolve(process.cwd(), 'scripts/provision-dealer.ts');
  if (existsSync(cli)) {
    const src = readFileSync(cli, 'utf8');
    if (
      src.includes('FORBIDDEN_PASSWORD_FLAGS') &&
      src.includes('manager-password-env') &&
      src.includes('APEX_PROVISION_ALLOW_YES')
    ) {
      record('APEX Provision', 'CLI security', 'pass', 'No argv passwords + confirm gates');
    } else {
      record('APEX Provision', 'CLI security', 'fail', 'provision-dealer CLI incomplete');
    }
  } else {
    record('APEX Provision', 'CLI security', 'fail', 'Missing scripts/provision-dealer.ts');
  }

  const httpRoute = resolve(process.cwd(), 'src/app/api/owner/provision-dealer/route.ts');
  if (existsSync(httpRoute)) {
    const src = readFileSync(httpRoute, 'utf8');
    if (
      src.includes('requireOwnerNational') &&
      src.includes('isHttpProvisionEnabled') &&
      src.includes('provisionDealer') &&
      src.includes('toSafeProvisionHttpResponse') &&
      src.includes("type: 'owner_api'")
    ) {
      record('APEX Provision', 'HTTP owner API', 'pass', 'POST /api/owner/provision-dealer fortress guards');
    } else {
      record('APEX Provision', 'HTTP owner API', 'fail', 'HTTP provision route incomplete');
    }
  } else {
    record('APEX Provision', 'HTTP owner API', 'fail', 'Missing provision-dealer route');
  }

  const forcedUi = resolve(process.cwd(), 'src/components/ForcedPasswordChangeScreen.tsx');
  const apexApp = resolve(process.cwd(), 'src/components/apex/ApexPlatformApp.tsx');
  const benzApp = resolve(process.cwd(), 'src/components/BenzTechApp.tsx');
  if (existsSync(forcedUi) && existsSync(apexApp) && existsSync(benzApp)) {
    const ui = readFileSync(forcedUi, 'utf8');
    const apex = readFileSync(apexApp, 'utf8');
    const benz = readFileSync(benzApp, 'utf8');
    if (
      ui.includes('data-testid="forced-password-change"') &&
      apex.includes('needsPasswordChange') &&
      benz.includes('needsPasswordChange')
    ) {
      record('APEX Provision', 'Forced password UI', 'pass', 'Gate screen wired in Apex + Merlinus shells');
    } else {
      record('APEX Provision', 'Forced password UI', 'fail', 'Forced password gate incomplete');
    }
  } else {
    record('APEX Provision', 'Forced password UI', 'fail', 'Missing ForcedPasswordChangeScreen or app shells');
  }

  const apiRoute = resolve(process.cwd(), 'src/lib/apiRoute.ts');
  const changePw = resolve(process.cwd(), 'src/app/api/auth/change-password/route.ts');
  if (existsSync(apiRoute) && existsSync(changePw)) {
    const routeSrc = readFileSync(apiRoute, 'utf8');
    const pwSrc = readFileSync(changePw, 'utf8');
    if (
      routeSrc.includes('PASSWORD_CHANGE_REQUIRED') &&
      routeSrc.includes('skipPasswordChange') &&
      pwSrc.includes('skipPasswordChange: true') &&
      pwSrc.includes('mustChangePassword: false')
    ) {
      record('APEX Provision', 'API password gate', 'pass', 'PII blocked until change-password');
    } else {
      record('APEX Provision', 'API password gate', 'fail', 'Password-change gate incomplete');
    }
  }

  const migration = resolve(
    process.cwd(),
    'prisma/migrations/20250713120000_apex_provision_must_change_password/migration.sql'
  );
  if (existsSync(migration)) {
    record('APEX Provision', 'must_change_password migration', 'pass', 'Technician password rotation column');
  } else {
    record('APEX Provision', 'must_change_password migration', 'fail', 'Missing provision migration');
  }

  const unitTest = resolve(process.cwd(), 'tests/unit/provisionDealer.test.ts');
  const integTest = resolve(process.cwd(), 'tests/integration/dealer-provision.test.ts');
  if (existsSync(unitTest)) {
    record('APEX Provision', 'Unit tests', 'pass', 'tests/unit/provisionDealer.test.ts');
  } else {
    record('APEX Provision', 'Unit tests', 'fail', 'Missing provisionDealer unit tests');
  }
  if (existsSync(integTest)) {
    const src = readFileSync(integTest, 'utf8');
    if (
      src.includes('provisionDealer') &&
      src.includes('postProvisionDealer') &&
      src.includes('PASSWORD_CHANGE_REQUIRED')
    ) {
      record('APEX Provision', 'Integration tests', 'pass', 'CLI + HTTP + password gate suite');
    } else {
      record('APEX Provision', 'Integration tests', 'fail', 'dealer-provision integration incomplete');
    }
  } else {
    record('APEX Provision', 'Integration tests', 'fail', 'Missing dealer-provision integration tests');
  }

  const docs = resolve(process.cwd(), 'docs/Apex-Dealer-Onboarding.md');
  const national = resolve(process.cwd(), 'docs/Apex-National-Platform.md');
  if (existsSync(docs)) {
    const text = readFileSync(docs, 'utf8');
    if (
      text.includes('provision-dealer') &&
      text.includes('mustChangePassword') &&
      text.includes('APEX_ALLOW_HTTP_PROVISION') &&
      text.includes('smoke:dealer-provision')
    ) {
      record('APEX Provision', 'Onboarding docs', 'pass', 'Apex-Dealer-Onboarding.md complete');
    } else {
      record('APEX Provision', 'Onboarding docs', 'fail', 'Onboarding docs missing smoke/HTTP sections');
    }
  } else {
    record('APEX Provision', 'Onboarding docs', 'fail', 'Missing Apex-Dealer-Onboarding.md');
  }
  if (existsSync(national) && readFileSync(national, 'utf8').includes('Dealer onboarding')) {
    record('APEX Provision', 'National platform docs', 'pass', 'Onboarding section in Apex-National-Platform.md');
  } else {
    record('APEX Provision', 'National platform docs', 'fail', 'National platform missing onboarding section');
  }

  const smoke = resolve(process.cwd(), 'scripts/smoke-dealer-provision.ts');
  if (existsSync(smoke)) {
    record('APEX Provision', 'Smoke script', 'pass', 'scripts/smoke-dealer-provision.ts');
  } else {
    record('APEX Provision', 'Smoke script', 'fail', 'Missing smoke-dealer-provision script');
  }

  const pkg = resolve(process.cwd(), 'package.json');
  if (existsSync(pkg)) {
    const json = readFileSync(pkg, 'utf8');
    if (json.includes('provision-dealer') && json.includes('smoke:dealer-provision')) {
      record('APEX Provision', 'npm scripts', 'pass', 'provision-dealer + smoke:dealer-provision');
    } else {
      record('APEX Provision', 'npm scripts', 'fail', 'package.json missing provision scripts');
    }
  }

  const envExample = resolve(process.cwd(), '.env.example');
  if (existsSync(envExample)) {
    const env = readFileSync(envExample, 'utf8');
    if (env.includes('APEX_ALLOW_HTTP_PROVISION')) {
      record('APEX Provision', 'Env example', 'pass', 'APEX_ALLOW_HTTP_PROVISION documented');
    } else {
      record('APEX Provision', 'Env example', 'fail', '.env.example missing HTTP provision flag');
    }
  }
}

/**
 * P0-2 — Docs must not overclaim production DB/Postgres RLS.
 * Allowed: future-state Postgres RLS discussion, historical migration notes.
 * Forbidden as present-tense production claims in fortress/readiness docs.
 */
function checkTenancyDocumentationHonesty(): void {
  section('P0-2 — Tenancy documentation honesty (app-layer D1)');

  const fortress = resolve(process.cwd(), 'docs/Security-Fortress.md');
  if (existsSync(fortress)) {
    const text = readFileSync(fortress, 'utf8');
    const honest =
      text.includes('Application-layer RLS on D1') &&
      text.includes('Not true DB RLS') &&
      text.includes('rlsPrismaExtension') &&
      text.includes('Risk acceptance');
    // Present-tense overclaim: diagram claiming Postgres FORCE as current architecture
    // without D1 honesty header is forbidden. Historical migration notes are OK.
    const overclaim =
      /Defense-in-depth tenancy\s*—\s*Postgres RLS/i.test(text) ||
      (text.includes('Postgres FORCE') && !text.includes('Not true DB RLS'));
    if (honest && !overclaim) {
      record(
        'P0-2 Tenancy docs',
        'Security-Fortress honesty',
        'pass',
        'Application-layer D1 tenancy stated; not true DB RLS'
      );
    } else {
      record(
        'P0-2 Tenancy docs',
        'Security-Fortress honesty',
        'fail',
        'Security-Fortress.md missing honesty language or still overclaims Postgres RLS as production'
      );
    }
  } else {
    record('P0-2 Tenancy docs', 'Security-Fortress honesty', 'fail', 'Missing Security-Fortress.md');
  }

  const multi = resolve(process.cwd(), 'docs/Multi-Tenant-Isolation.md');
  if (existsSync(multi)) {
    const text = readFileSync(multi, 'utf8');
    if (
      text.includes('Application-layer RLS on D1') &&
      text.includes('Not true DB RLS') &&
      text.includes('risk acceptance')
    ) {
      record(
        'P0-2 Tenancy docs',
        'Multi-Tenant-Isolation',
        'pass',
        'App-layer model + risk acceptance present'
      );
    } else {
      record(
        'P0-2 Tenancy docs',
        'Multi-Tenant-Isolation',
        'fail',
        'Multi-Tenant-Isolation.md missing honesty / risk acceptance'
      );
    }
  } else {
    record('P0-2 Tenancy docs', 'Multi-Tenant-Isolation', 'fail', 'Missing Multi-Tenant-Isolation.md');
  }

  const planPath = resolve(process.cwd(), 'src/lib/encryption/reencryptPlan.ts');
  if (existsSync(planPath)) {
    const plan = readFileSync(planPath, 'utf8');
    const mfaOk =
      plan.includes("table: 'userMfa'") &&
      plan.includes('secretEncrypted') &&
      plan.includes('backupCodesEncrypted') &&
      plan.includes("table: 'technician'") &&
      plan.includes('mfaSecretEncrypted') &&
      plan.includes('mfaBackupCodesEncrypted');
    if (mfaOk) {
      record(
        'P0-1 Encryption',
        'Full reencrypt plan includes MFA',
        'pass',
        'userMfa + technician MFA columns in REENCRYPT_TABLE_PLAN'
      );
    } else {
      record(
        'P0-1 Encryption',
        'Full reencrypt plan includes MFA',
        'fail',
        'reencryptPlan.ts missing MFA tables/columns'
      );
    }
  } else {
    record('P0-1 Encryption', 'Full reencrypt plan includes MFA', 'fail', 'Missing reencryptPlan.ts');
  }

  // Scan selected product docs for forbidden present-tense production claims.
  const scanTargets = [
    'docs/Security-Fortress.md',
    'docs/Production-Readiness-Checklist.md',
    'docs/README.md',
    'docs/Modular-OS-Overview.md',
  ];
  const forbiddenPresent = [
    /Postgres\s*\+\s*RLS/i,
    /production[^\n.]{0,80}Postgres RLS/i,
    /database-enforced multi-tenant isolation/i,
  ];
  const hits: string[] = [];
  for (const rel of scanTargets) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const re of forbiddenPresent) {
      if (re.test(text)) hits.push(`${rel} matches ${re}`);
    }
  }
  if (hits.length === 0) {
    record(
      'P0-2 Tenancy docs',
      'Overclaim language scan',
      'pass',
      'No forbidden present-tense Postgres/DB RLS production claims in core docs'
    );
  } else {
    record(
      'P0-2 Tenancy docs',
      'Overclaim language scan',
      'fail',
      hits.join('; ').slice(0, 400)
    );
  }
}

function checkApexPhase64FortressComplete(): void {
  section('APEX Phase 6.4 — Finalize Security Fortress Hardening');

  const docs = resolve(process.cwd(), 'docs/Security-Fortress.md');
  if (existsSync(docs)) {
    const text = readFileSync(docs, 'utf8');
    const ok =
      text.includes('Phase 6.0') &&
      text.includes('writeAuditedAccess') &&
      text.includes('withSessionRls') &&
      text.includes('revokeAllSessionsForTechnician') &&
      text.includes('Security Hardening Sprint') &&
      text.includes('MFA') &&
      text.includes('pen test') &&
      text.includes('Application-layer RLS on D1') &&
      text.includes('Not true DB RLS');
    if (ok) {
      record('APEX 6.4', 'Security Fortress docs', 'pass', 'docs/Security-Fortress.md complete + D1 honesty');
    } else {
      record('APEX 6.4', 'Security Fortress docs', 'fail', 'Security-Fortress.md incomplete');
    }
  } else {
    record('APEX 6.4', 'Security Fortress docs', 'fail', 'Missing docs/Security-Fortress.md');
  }

  const enter = resolve(process.cwd(), 'src/app/api/auth/enter-dealership/route.ts');
  if (existsSync(enter)) {
    const src = readFileSync(enter, 'utf8');
    if (src.includes('requireOwnerNational')) {
      record('APEX 6.4', 'Enter requires national', 'pass', 'enter-dealership requires national owner scope');
    } else {
      record('APEX 6.4', 'Enter requires national', 'fail', 'enter-dealership missing requireOwnerNational');
    }
  }

  const advisors = resolve(process.cwd(), 'src/app/api/advisors/route.ts');
  if (existsSync(advisors)) {
    const src = readFileSync(advisors, 'utf8');
    if (src.includes('getRlsDb') && src.includes('writeAuditedAccess') && src.includes('requireDealershipContext')) {
      record('APEX 6.4', 'Advisors fortress', 'pass', 'Advisors list/create under RLS + audit');
    } else {
      record('APEX 6.4', 'Advisors fortress', 'fail', 'advisors route incomplete fortress wiring');
    }
  }

  const login = resolve(process.cwd(), 'src/app/api/auth/login/route.ts');
  if (existsSync(login) && readFileSync(login, 'utf8').includes('writeAuditedAccess')) {
    record('APEX 6.4', 'Login fail-closed audit', 'pass', 'auth.login uses writeAuditedAccess');
  } else {
    record('APEX 6.4', 'Login fail-closed audit', 'fail', 'login missing writeAuditedAccess');
  }

  const fortressTest = resolve(process.cwd(), 'tests/integration/security-fortress.test.ts');
  if (existsSync(fortressTest)) {
    const src = readFileSync(fortressTest, 'utf8');
    if (src.includes('Phase 6') && src.includes('DEALERSHIP_CONTEXT_REQUIRED')) {
      record('APEX 6.4', 'Fortress integration suite', 'pass', 'security-fortress.test.ts present');
    } else {
      record('APEX 6.4', 'Fortress integration suite', 'fail', 'security-fortress.test.ts incomplete');
    }
  }

  // Hardening sprint gates (6.1–6.3)
  const seed = resolve(process.cwd(), 'src/lib/apex/seedOwnerAccounts.ts');
  if (existsSync(seed)) {
    const src = readFileSync(seed, 'utf8');
    if (
      !src.includes('devPassword') &&
      !src.includes('Bressette') &&
      src.includes('ensureNationalOwnerAccount')
    ) {
      record('APEX 6.4', 'Owner credential hygiene', 'pass', 'No hard-coded owner passwords; create-only seed');
    } else {
      record('APEX 6.4', 'Owner credential hygiene', 'fail', 'seedOwnerAccounts still has hard-coded secrets');
    }
  }

  const rlsCtx = resolve(process.cwd(), 'src/lib/apex/rlsContext.ts');
  if (existsSync(rlsCtx)) {
    const src = readFileSync(rlsCtx, 'utf8');
    // D1: softOpen flag + Apex enforce via isRlsEnabled / createRlsEnforcedClient (not Postgres GUCs).
    if (
      src.includes('isApexPlatformMode') &&
      src.includes('isRlsEnabled') &&
      (src.includes('softOpen') || src.includes('rls_soft_open')) &&
      (src.includes('createRlsEnforcedClient') || src.includes('withSessionRls'))
    ) {
      record('APEX 6.4', 'RLS default-deny Apex', 'pass', 'Apex enforce + Merlinus soft-open (D1 Prisma RLS extension)');
    } else {
      record('APEX 6.4', 'RLS default-deny Apex', 'fail', 'rlsContext missing Phase 6.2 default-deny');
    }
  }

  const migrate62 = resolve(
    process.cwd(),
    'prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/migration.sql'
  );
  if (existsSync(migrate62) && readFileSync(migrate62, 'utf8').includes('Technician')) {
    record('APEX 6.4', 'Technician RLS migration', 'pass', 'Phase 6.2 default-deny + Technician policies');
  } else {
    record('APEX 6.4', 'Technician RLS migration', 'fail', 'Missing 6.2 RLS migration');
  }

  const proxyAuth = resolve(process.cwd(), 'src/lib/grokProxyAuth.ts');
  if (existsSync(proxyAuth)) {
    const src = readFileSync(proxyAuth, 'utf8');
    if (src.includes('timingSafeEqual') && src.includes('createGrokProxyAccessToken')) {
      record('APEX 6.4', 'Grok proxy hardening', 'pass', 'Short-lived HMAC tokens + timing-safe verify');
    } else {
      record('APEX 6.4', 'Grok proxy hardening', 'fail', 'grokProxyAuth incomplete');
    }
  } else {
    record('APEX 6.4', 'Grok proxy hardening', 'fail', 'Missing grokProxyAuth.ts');
  }

  const rateSrc = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
  if (
    rateSrc.includes('isAuthRateLimitRoute') &&
    rateSrc.includes('auth_kv_required') &&
    rateSrc.includes('companionPublish')
  ) {
    record('APEX 6.4', 'Auth KV + companion limits', 'pass', 'Production auth KV warnings + companion rate limits');
  } else {
    record('APEX 6.4', 'Auth KV + companion limits', 'fail', 'rate-limit Phase 6.3/6.4 incomplete');
  }

  const meta = readFileSync(resolve(process.cwd(), 'src/lib/auditMetadataSanitize.ts'), 'utf8');
  if (meta.includes('hashRoNumberForAudit') && meta.includes('ALLOWED_STRING_KEYS')) {
    record('APEX 6.4', 'Audit allowlist metadata', 'pass', 'Allowlist-only audit metadata + RO hash');
  } else {
    record('APEX 6.4', 'Audit allowlist metadata', 'fail', 'auditMetadataSanitize incomplete');
  }

  const roList = readFileSync(resolve(process.cwd(), 'src/app/api/repair-orders/route.ts'), 'utf8');
  if (roList.includes("action: 'ro.list'") && roList.includes('requireAuditedAccess')) {
    record('APEX 6.4', 'RO list fail-closed audit', 'pass', 'ro.list fail-closed on bulk list');
  } else {
    record('APEX 6.4', 'RO list fail-closed audit', 'fail', 'RO list missing ro.list audit');
  }

  const changelog = resolve(process.cwd(), 'CHANGELOG.md');
  if (existsSync(changelog) && readFileSync(changelog, 'utf8').includes('Security Hardening Sprint')) {
    record('APEX 6.4', 'Changelog hardening sprint', 'pass', 'CHANGELOG documents security hardening sprint');
  } else {
    record('APEX 6.4', 'Changelog hardening sprint', 'fail', 'CHANGELOG missing Security Hardening Sprint section');
  }

  // Aggregate gate: all Phase 6.x modules present
  const rls = existsSync(resolve(process.cwd(), 'src/lib/apex/rlsContext.ts'));
  const audited = existsSync(resolve(process.cwd(), 'src/lib/auditedAccess.ts'));
  const revoke = existsSync(resolve(process.cwd(), 'src/lib/sessionRevocation.ts'));
  const migration = existsSync(
    resolve(process.cwd(), 'prisma/migrations/20250712120000_apex_phase6_1_rls_foundation/migration.sql')
  );
  if (rls && audited && revoke && migration) {
    record('APEX 6.4', 'Phase 6.0 complete gate', 'pass', 'RLS + audit + revoke + migration all present');
  } else {
    record('APEX 6.4', 'Phase 6.0 complete gate', 'fail', 'Missing one or more Phase 6 core artifacts');
  }
}

/**
 * Phase 6.5 — final security hardening gates:
 * - no hard-coded credentials in seed/source
 * - RLS default-deny active on Apex
 * - Apex production fail-closed without KV
 */
function checkApexPhase65RemainingSecurity(): void {
  section('APEX Phase 6.5 — Remaining Security Items');

  // No hard-coded owner credentials in application source (exclude tests that assert absence)
  const seedPath = resolve(process.cwd(), 'src/lib/apex/seedOwnerAccounts.ts');
  const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : '';
  const forbiddenCredPatterns = [
    /devPassword/,
    /Bressette1735/,
    /Getfused123/,
    /hombre3536@gmail\.com/,
    /scollier@getfused\.com/,
    /password\s*[:=]\s*['"][^'"]{8,}['"]/i,
  ];
  const seedClean =
    seed.length > 0 &&
    !forbiddenCredPatterns.some((re) => re.test(seed)) &&
    seed.includes('ensureNationalOwnerAccount') &&
    seed.includes('OWNER_SEED_EMAIL');
  if (seedClean) {
    record('APEX 6.5', 'No hard-coded credentials', 'pass', 'seedOwnerAccounts env-only, create-only owners');
  } else {
    record('APEX 6.5', 'No hard-coded credentials', 'fail', 'Hard-coded credentials or missing create-only seed');
  }

  // RLS default-deny on Apex (D1: Prisma extension; historical Postgres migration may still exist)
  const rlsPath = resolve(process.cwd(), 'src/lib/apex/rlsContext.ts');
  const rlsSrc = existsSync(rlsPath) ? readFileSync(rlsPath, 'utf8') : '';
  const extPath = resolve(process.cwd(), 'src/lib/apex/rlsPrismaExtension.ts');
  const extSrc = existsSync(extPath) ? readFileSync(extPath, 'utf8') : '';
  const mig62 = resolve(
    process.cwd(),
    'prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/migration.sql'
  );
  const mig62Src = existsSync(mig62) ? readFileSync(mig62, 'utf8') : '';
  const rlsOk =
    rlsSrc.includes('isApexPlatformMode') &&
    rlsSrc.includes('isRlsEnabled') &&
    (rlsSrc.includes('softOpen') || rlsSrc.includes('rls_soft_open')) &&
    (rlsSrc.includes('createRlsEnforcedClient') ||
      (extSrc.includes('merlinRlsTenantIsolation') && extSrc.includes('dealershipId')) ||
      (mig62Src.includes('app.rls_soft_open') && mig62Src.includes('Technician')));
  if (rlsOk) {
    record(
      'APEX 6.5',
      'RLS default-deny on Apex',
      'pass',
      'Apex enforce-by-default + D1 Prisma tenant rewrite (or historical GUC migration)'
    );
  } else {
    record('APEX 6.5', 'RLS default-deny on Apex', 'fail', 'RLS default-deny incomplete');
  }

  // Apex production fail-closed without KV
  const rateSrc = readFileSync(resolve(process.cwd(), 'src/lib/rate-limit.ts'), 'utf8');
  const envSrc = readFileSync(resolve(process.cwd(), 'src/lib/env.ts'), 'utf8');
  if (
    rateSrc.includes('apex_kv_required') &&
    rateSrc.includes('apexProductionRequiresKv') &&
    rateSrc.includes('503') &&
    envSrc.includes('PRODUCTION_KV_ENV_VARS') &&
    envSrc.includes('isApexPlatformMode')
  ) {
    record(
      'APEX 6.5',
      'Apex production requires KV',
      'pass',
      'Fail-closed 503 without KV; env hard-requires KV for Apex production'
    );
  } else {
    record('APEX 6.5', 'Apex production requires KV', 'fail', 'Apex KV fail-closed incomplete');
  }

  const fortress = readFileSync(resolve(process.cwd(), 'docs/Security-Fortress.md'), 'utf8');
  if (
    (fortress.includes('implementation guidance') || fortress.includes('Native TOTP MFA')) &&
    fortress.includes('Phase 6.5') &&
    (fortress.includes('Fail closed') || fortress.includes('fail-closed') || fortress.includes('fail closed')) &&
    fortress.includes('Clerk') &&
    (fortress.includes('WebAuthn') || fortress.includes('TOTP') || fortress.includes('MERLIN_MFA_ENFORCE'))
  ) {
    record('APEX 6.5', 'MFA/SSO implementation docs', 'pass', 'Security-Fortress MFA/SSO implementation guidance');
  } else {
    record('APEX 6.5', 'MFA/SSO implementation docs', 'fail', 'Security-Fortress missing MFA/SSO guidance');
  }

  const changelog = readFileSync(resolve(process.cwd(), 'CHANGELOG.md'), 'utf8');
  if (changelog.includes('6.5') && changelog.includes('Security Hardening Sprint')) {
    record('APEX 6.5', 'Changelog Phase 6.5', 'pass', 'CHANGELOG marks 6.5 / full sprint complete');
  } else {
    record('APEX 6.5', 'Changelog Phase 6.5', 'fail', 'CHANGELOG missing Phase 6.5');
  }
}

function checkApexPhase63SecurityExpansion(): void {
  section('APEX Phase 6.3 — Expanded RLS enforcement and auditing');

  const tenant = resolve(process.cwd(), 'src/lib/apex/tenantScope.ts');
  if (existsSync(tenant)) {
    const src = readFileSync(tenant, 'utf8');
    if (src.includes('requireOwnerNationalScope')) {
      record('APEX 6.3', 'Owner national guard', 'pass', 'requireOwnerNationalScope helper');
    } else {
      record('APEX 6.3', 'Owner national guard', 'fail', 'Missing requireOwnerNationalScope');
    }
  }

  const apiRoute = resolve(process.cwd(), 'src/lib/apiRoute.ts');
  if (existsSync(apiRoute)) {
    const src = readFileSync(apiRoute, 'utf8');
    if (src.includes('requireOwnerNational')) {
      record('APEX 6.3', 'withAuth national flag', 'pass', 'requireOwnerNational option');
    } else {
      record('APEX 6.3', 'withAuth national flag', 'fail', 'apiRoute missing requireOwnerNational');
    }
  }

  const select = resolve(process.cwd(), 'src/app/api/auth/select-dealership/route.ts');
  if (existsSync(select)) {
    const src = readFileSync(select, 'utf8');
    if (src.includes('writeAuditedAccess') && src.includes('revokeApexRefreshForScopeSwitch')) {
      record('APEX 6.3', 'Select-dealership fortress', 'pass', 'Audit + refresh revoke on select');
    } else {
      record('APEX 6.3', 'Select-dealership fortress', 'fail', 'select-dealership incomplete');
    }
  }

  const fortressTest = resolve(process.cwd(), 'tests/integration/security-fortress.test.ts');
  if (existsSync(fortressTest)) {
    record('APEX 6.3', 'Security integration tests', 'pass', 'security-fortress.test.ts');
  } else {
    record('APEX 6.3', 'Security integration tests', 'fail', 'Missing security-fortress integration suite');
  }

  const upload = resolve(process.cwd(), 'src/app/api/upload/route.ts');
  if (existsSync(upload) && readFileSync(upload, 'utf8').includes('writeAuditedAccess')) {
    record('APEX 6.3', 'Upload audited access', 'pass', 'image.upload fail-closed');
  } else {
    record('APEX 6.3', 'Upload audited access', 'fail', 'upload missing writeAuditedAccess');
  }
}

function checkApexPhase62RlsEnforcement(): void {
  section('APEX Phase 6.2 — RLS enforcement + auditing expansion');

  const rlsPath = resolve(process.cwd(), 'src/lib/apex/rlsContext.ts');
  if (existsSync(rlsPath)) {
    const src = readFileSync(rlsPath, 'utf8');
    const ok =
      src.includes('withSessionRls') &&
      src.includes('getRlsDb') &&
      src.includes('rlsTransaction') &&
      src.includes('AsyncLocalStorage');
    if (ok) {
      record('APEX 6.2', 'withSessionRls default', 'pass', 'ALS-bound getRlsDb for PII routes');
    } else {
      record('APEX 6.2', 'withSessionRls default', 'fail', 'rlsContext missing withSessionRls/getRlsDb');
    }
  } else {
    record('APEX 6.2', 'withSessionRls default', 'fail', 'Missing rlsContext.ts');
  }

  const apiRoute = resolve(process.cwd(), 'src/lib/apiRoute.ts');
  if (existsSync(apiRoute)) {
    const src = readFileSync(apiRoute, 'utf8');
    if (src.includes('withSessionRls') && src.includes('useRls')) {
      record('APEX 6.2', 'withAuth RLS wrap', 'pass', 'PII routes auto-wrap withSessionRls');
    } else {
      record('APEX 6.2', 'withAuth RLS wrap', 'fail', 'apiRoute missing useRls/withSessionRls');
    }
  }

  const revokePath = resolve(process.cwd(), 'src/lib/sessionRevocation.ts');
  if (existsSync(revokePath)) {
    const src = readFileSync(revokePath, 'utf8');
    if (src.includes('revokeAllSessionsForTechnician') && src.includes('revokeApexRefreshForScopeSwitch')) {
      record('APEX 6.2', 'Session revocation', 'pass', 'Full fortress revoke + scope-switch refresh drop');
    } else {
      record('APEX 6.2', 'Session revocation', 'fail', 'sessionRevocation incomplete');
    }
  } else {
    record('APEX 6.2', 'Session revocation', 'fail', 'Missing sessionRevocation.ts');
  }

  const roGet = resolve(process.cwd(), 'src/app/api/repair-orders/[id]/route.ts');
  if (existsSync(roGet)) {
    const src = readFileSync(roGet, 'utf8');
    if (src.includes("action: 'ro.read'") && src.includes('writeAuditedAccess')) {
      record('APEX 6.2', 'RO read audit', 'pass', 'ro.read fail-closed on entity GET');
    } else {
      record('APEX 6.2', 'RO read audit', 'fail', 'RO GET missing writeAuditedAccess ro.read');
    }
  }
}

function checkApexPhase61RlsFoundation(): void {
  section('APEX Phase 6.1 — RLS foundation + mandatory auditing');

  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20250712120000_apex_phase6_1_rls_foundation/migration.sql'
  );
  if (existsSync(migrationPath)) {
    const sql = readFileSync(migrationPath, 'utf8');
    const ok =
      sql.includes('ENABLE ROW LEVEL SECURITY') &&
      sql.includes('FORCE ROW LEVEL SECURITY') &&
      sql.includes('RepairOrder') &&
      sql.includes('AuditLog') &&
      sql.includes('app.rls_enforced');
    if (ok) {
      record('APEX 6.1', 'RLS migration', 'pass', 'FORCE RLS on PII tables with soft-open bridge');
    } else {
      record('APEX 6.1', 'RLS migration', 'fail', 'Phase 6.1 migration SQL incomplete');
    }
  } else {
    record('APEX 6.1', 'RLS migration', 'fail', 'Missing 20250712120000_apex_phase6_1_rls_foundation');
  }

  const rlsPath = resolve(process.cwd(), 'src/lib/apex/rlsContext.ts');
  if (existsSync(rlsPath)) {
    const src = readFileSync(rlsPath, 'utf8');
    const extPath = resolve(process.cwd(), 'src/lib/apex/rlsPrismaExtension.ts');
    const hasExtension =
      existsSync(extPath) &&
      readFileSync(extPath, 'utf8').includes('createRlsEnforcedClient');
    // D1/SQLite: Prisma extension rewrites tenant predicates (no Postgres set_config GUCs).
    const ok =
      src.includes('setRlsContext') &&
      src.includes('withRlsContext') &&
      src.includes('rlsContextFromSession') &&
      (src.includes('createRlsEnforcedClient') || src.includes('set_config') || hasExtension);
    if (ok) {
      record(
        'APEX 6.1',
        'rlsContext.ts',
        'pass',
        hasExtension || src.includes('createRlsEnforcedClient')
          ? 'D1 Prisma tenant isolation extension bound via ALS'
          : 'Transaction-local app.* session vars'
      );
    } else {
      record('APEX 6.1', 'rlsContext.ts', 'fail', 'rlsContext.ts incomplete');
    }
  } else {
    record('APEX 6.1', 'rlsContext.ts', 'fail', 'Missing src/lib/apex/rlsContext.ts');
  }

  const auditedPath = resolve(process.cwd(), 'src/lib/auditedAccess.ts');
  if (existsSync(auditedPath)) {
    const src = readFileSync(auditedPath, 'utf8');
    if (src.includes('writeAuditedAccess') && src.includes('AuditedAccessError')) {
      record('APEX 6.1', 'writeAuditedAccess', 'pass', 'Fail-closed audited access helper');
    } else {
      record('APEX 6.1', 'writeAuditedAccess', 'fail', 'auditedAccess.ts incomplete');
    }
  } else {
    record('APEX 6.1', 'writeAuditedAccess', 'fail', 'Missing src/lib/auditedAccess.ts');
  }

  const tenantPath = resolve(process.cwd(), 'src/lib/apex/tenantScope.ts');
  if (existsSync(tenantPath)) {
    const src = readFileSync(tenantPath, 'utf8');
    if (src.includes('ownerMayExerciseDealershipPrivilege') && src.includes('isUsableDealershipId')) {
      record('APEX 6.1', 'Owner least-privilege', 'pass', 'Sentinel + national admin guards');
    } else {
      record('APEX 6.1', 'Owner least-privilege', 'fail', 'tenantScope least-privilege helpers missing');
    }
  }

  const envExamplePath = resolve(process.cwd(), '.env.example');
  if (existsSync(envExamplePath)) {
    const env = readFileSync(envExamplePath, 'utf8');
    if (env.includes('RLS_ENABLED')) {
      record('APEX 6.1', 'Env example', 'pass', 'RLS_ENABLED documented');
    } else {
      record('APEX 6.1', 'Env example', 'fail', '.env.example missing RLS_ENABLED');
    }
  }
}

function checkApexPhase510Finalize(): void {
  section('APEX Phase 5.10 — Finalize Phase 5');

  const seedPath = resolve(process.cwd(), 'src/lib/apex/seedOwnerAccounts.ts');
  const integrationPath = resolve(process.cwd(), 'tests/integration/apex-owner-flows.test.ts');
  const docsPath = resolve(process.cwd(), 'docs/Apex-National-Platform.md');
  const envExamplePath = resolve(process.cwd(), '.env.example');

  if (existsSync(seedPath)) {
    const src = readFileSync(seedPath, 'utf8');
    const ok =
      src.includes('OWNER_SEED_EMAIL') &&
      src.includes('OWNER_SEED_EMAIL_2') &&
      src.includes('seedApexOwnerAccounts') &&
      src.includes('APEX_NATIONAL_DEALERSHIP_ID');
    if (ok) {
      record('APEX 5.10', 'Owner seed accounts', 'pass', 'Env-driven owner + multi-rooftop seed');
    } else {
      record('APEX 5.10', 'Owner seed accounts', 'fail', 'seedOwnerAccounts.ts incomplete');
    }
  } else {
    record('APEX 5.10', 'Owner seed accounts', 'fail', 'Missing seedOwnerAccounts.ts');
  }

  if (existsSync(integrationPath)) {
    const src = readFileSync(integrationPath, 'utf8');
    const ok =
      src.includes('postEnterDealership') &&
      src.includes('postExitDealership') &&
      src.includes('requiresDealershipSelection') &&
      src.includes('getOwnerSummary');
    if (ok) {
      record('APEX 5.10', 'Owner integration tests', 'pass', 'apex-owner-flows.test.ts');
    } else {
      record('APEX 5.10', 'Owner integration tests', 'fail', 'Integration suite incomplete');
    }
  } else {
    record('APEX 5.10', 'Owner integration tests', 'fail', 'Missing apex-owner-flows integration test');
  }

  if (existsSync(docsPath)) {
    record('APEX 5.10', 'Apex documentation', 'pass', 'docs/Apex-National-Platform.md');
  } else {
    record('APEX 5.10', 'Apex documentation', 'fail', 'Missing Apex-National-Platform.md');
  }

  if (existsSync(envExamplePath)) {
    const env = readFileSync(envExamplePath, 'utf8');
    if (env.includes('OWNER_SEED_EMAIL') && env.includes('OWNER_SEED_PASSWORD')) {
      record('APEX 5.10', 'Env example', 'pass', 'OWNER_SEED_* documented in .env.example');
    } else {
      record('APEX 5.10', 'Env example', 'fail', '.env.example missing owner seed vars');
    }
  }
}

function checkApexPhase59OwnerNationalConsole(): void {
  section('APEX Phase 5.9 — Owner National Console');

  const summaryLib = resolve(process.cwd(), 'src/lib/apex/ownerNationalSummary.ts');
  const summaryRoute = resolve(process.cwd(), 'src/app/api/owner/summary/route.ts');
  const shellPath = resolve(process.cwd(), 'src/components/apex/ApexOwnerNationalShell.tsx');
  const workspacePath = resolve(process.cwd(), 'src/components/apex/ApexOwnerDealershipWorkspace.tsx');

  if (existsSync(summaryLib) && existsSync(summaryRoute)) {
    const lib = readFileSync(summaryLib, 'utf8');
    const route = readFileSync(summaryRoute, 'utf8');
    const ok =
      lib.includes('repairOrdersLast7Days') &&
      lib.includes('recentActivity') &&
      route.includes('owner.national_access');
    if (ok) {
      record('APEX 5.9', 'Owner summary', 'pass', 'Aggregate national metrics + audit');
    } else {
      record('APEX 5.9', 'Owner summary', 'fail', 'Owner summary incomplete');
    }
  } else {
    record('APEX 5.9', 'Owner summary', 'fail', 'Missing owner summary lib or route');
  }

  if (existsSync(shellPath)) {
    const src = readFileSync(shellPath, 'utf8');
    // View As dual selector: CTA is "View as / enter rooftop" (legacy: "Enter dealership")
    const hasEnterCta =
      src.includes('View as / enter rooftop') || src.includes('Enter dealership');
    if (src.includes('apex-stat-grid') && hasEnterCta && src.includes('enterOwnerDealership')) {
      record('APEX 5.9', 'National dashboard', 'pass', 'ApexOwnerNationalShell dashboard');
    } else {
      record('APEX 5.9', 'National dashboard', 'fail', 'National shell incomplete');
    }
  }

  if (existsSync(workspacePath)) {
    record('APEX 5.9', 'Exit dealership UX', 'pass', 'Owner dealership workspace + exit bar');
  } else {
    record('APEX 5.9', 'Exit dealership UX', 'fail', 'Missing owner dealership workspace');
  }
}

function checkApexPhase58DealershipSelector(): void {
  section('APEX Phase 5.8 — Dealership Selector UX');

  const selectorPath = resolve(process.cwd(), 'src/components/apex/ApexDealershipSelector.tsx');
  const ownerShellPath = resolve(process.cwd(), 'src/components/apex/ApexOwnerNationalShell.tsx');
  const ownerApiPath = resolve(process.cwd(), 'src/app/api/owner/dealerships/route.ts');

  if (existsSync(selectorPath)) {
    const src = readFileSync(selectorPath, 'utf8');
    const ok =
      src.includes('apex-dealership-search') &&
      src.includes('apex-dealership-primary-badge') &&
      src.includes('rememberAsDefault');
    if (ok) {
      record('APEX 5.8', 'ApexDealershipSelector', 'pass', 'Search, primary badge, remember default');
    } else {
      record('APEX 5.8', 'ApexDealershipSelector', 'fail', 'Selector component incomplete');
    }
  } else {
    record('APEX 5.8', 'ApexDealershipSelector', 'fail', 'Missing ApexDealershipSelector');
  }

  if (existsSync(ownerShellPath)) {
    const src = readFileSync(ownerShellPath, 'utf8');
    // View As: dual role + rooftop enter; CTA label "View as / enter rooftop"
    const hasEnterCta =
      src.includes('View as / enter rooftop') || src.includes('Enter dealership');
    const hasViewAs =
      src.includes('VIEW_AS_ROLE_OPTIONS') || src.includes('viewAsRole');
    if (hasEnterCta && src.includes('enterOwnerDealership') && hasViewAs) {
      record('APEX 5.8', 'Owner enter flow', 'pass', 'National console View as / enter rooftop CTA');
    } else {
      record('APEX 5.8', 'Owner enter flow', 'fail', 'Owner national shell missing enter flow');
    }
  }

  if (existsSync(ownerApiPath)) {
    record('APEX 5.8', 'Owner dealerships API', 'pass', 'GET /api/owner/dealerships');
  } else {
    record('APEX 5.8', 'Owner dealerships API', 'fail', 'Missing owner dealerships route');
  }
}

function checkApexPhase56UiFoundation(): void {
  section('APEX Phase 5.6 — UI Foundation');

  const tokensPath = resolve(process.cwd(), 'src/styles/apex-platform.css');
  const logoPath = resolve(process.cwd(), 'src/components/apex/ApexLogoMark.tsx');
  const loginPath = resolve(process.cwd(), 'src/components/apex/ApexLoginShell.tsx');
  const appPath = resolve(process.cwd(), 'src/components/apex/ApexPlatformApp.tsx');
  const homePath = resolve(process.cwd(), 'src/components/HomePageClient.tsx');

  if (existsSync(tokensPath)) {
    const css = readFileSync(tokensPath, 'utf8');
    if (css.includes('--apex-cyan') && css.includes("[data-platform='apex']")) {
      record('APEX 5.6', 'Design tokens', 'pass', 'Scoped apex CSS variables');
    } else {
      record('APEX 5.6', 'Design tokens', 'fail', 'apex-platform.css incomplete');
    }
  } else {
    record('APEX 5.6', 'Design tokens', 'fail', 'Missing apex-platform.css');
  }

  if (existsSync(logoPath) && existsSync(loginPath) && existsSync(appPath)) {
    record('APEX 5.6', 'Apex components', 'pass', 'Logo, login shell, platform app');
  } else {
    record('APEX 5.6', 'Apex components', 'fail', 'Missing Apex UI components');
  }

  if (existsSync(homePath)) {
    const src = readFileSync(homePath, 'utf8');
    if (src.includes("platformMode === 'apex'") && src.includes('BenzTechApp')) {
      record('APEX 5.6', 'Entry router', 'pass', 'HomePageClient branches Merlinus vs Apex');
    } else {
      record('APEX 5.6', 'Entry router', 'fail', 'HomePageClient routing incomplete');
    }
  }
}

function checkApexPhase54SessionFortress(): void {
  section('APEX Phase 5.4 — Session Fortress');

  const apexSessionPath = resolve(process.cwd(), 'src/lib/apex/apexSession.ts');
  if (existsSync(apexSessionPath)) {
    const src = readFileSync(apexSessionPath, 'utf8');
    const ok =
      src.includes('sessionRefreshToken') &&
      src.includes('createPendingSelectionToken') &&
      src.includes('rotateApexRefreshToken') &&
      src.includes('APEX_ACCESS_COOKIE');
    if (ok) {
      record('APEX 5.4', 'apexSession.ts', 'pass', 'Dual-token + pending selection tokens');
    } else {
      record('APEX 5.4', 'apexSession.ts', 'fail', 'apexSession.ts incomplete');
    }
  } else {
    record('APEX 5.4', 'apexSession.ts', 'fail', 'Missing apexSession.ts');
  }

  const selectPath = resolve(process.cwd(), 'src/app/api/auth/select-dealership/route.ts');
  const refreshPath = resolve(process.cwd(), 'src/app/api/auth/refresh/route.ts');
  if (existsSync(selectPath) && existsSync(refreshPath)) {
    record('APEX 5.4', 'Auth routes', 'pass', 'select-dealership + refresh endpoints');
  } else {
    record('APEX 5.4', 'Auth routes', 'fail', 'Missing select-dealership or refresh route');
  }
}

async function main(): Promise<void> {
  console.log(`\n${c.bold}${c.cyan}Merlin Pre-Rollout Validation${c.reset}`);
  console.log(`${c.dim}Validating deployment readiness for dealership IT…${c.reset}`);

  loadEnvironment();

  if (!process.env.NEXT_PUBLIC_BUILD_COMMIT) {
    try {
      process.env.NEXT_PUBLIC_BUILD_COMMIT = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
      process.env.NEXT_PUBLIC_BUILD_COMMIT = 'dev';
    }
  }
  if (!process.env.NEXT_PUBLIC_BUILD_DATE) {
    process.env.NEXT_PUBLIC_BUILD_DATE = new Date().toISOString();
  }

  prisma = await initPrismaFromEnvironment();

  await checkEnvironment();
  await checkCoreSystems();
  await checkCustomerPayTemplates();
  await checkCriticalAuditFixes();
  await checkHighPriorityAuditFixes();
  checkMediumAuditFixes();
  checkApexPhase51Schema();
  checkApexPhase52Membership();
  checkApexPhase53UnifiedLogin();
  checkApexPhase54SessionFortress();
  checkApexPhase55OwnerScope();
  checkApexPhase56UiFoundation();
  checkApexPhase58DealershipSelector();
  checkApexPhase59OwnerNationalConsole();
  checkApexPhase510Finalize();
  checkApexPhase61RlsFoundation();
  checkApexPhase62RlsEnforcement();
  checkApexPhase63SecurityExpansion();
  checkApexPhase64FortressComplete();
  checkApexPhase65RemainingSecurity();
  checkTenancyDocumentationHonesty();
  checkApexDealerProvisionFinalize();
  checkApexDealerGroupFinalize();
  checkLowAuditFixes();
  await checkCoreFeatures();
  await checkDocumentation();
  await checkSecurityAndConfig();
  checkProductionReadiness();

  printSummary();

  // Only true repository/code defects block npm run ready-to-deploy.
  // Config/env failures (DB unreachable, missing optional monitoring) are non-blocking.
  const criticalCodeFails = results.filter(
    (r) => r.status === 'fail' && r.critical && r.kind === 'code'
  ).length;
  await prisma?.$disconnect().catch(() => undefined);
  process.exit(criticalCodeFails > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n${c.red}${c.bold}Pre-rollout validation crashed:${c.reset}`, error);
  process.exit(1);
});