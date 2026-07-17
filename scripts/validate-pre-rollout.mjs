#!/usr/bin/env node
/**
 * Read-only pre-rollout live probe — complements validate:pre-deploy and validate:pre-rollout.
 * Does not mutate data or change application behavior.
 *
 * Usage:
 *   node scripts/validate-pre-rollout.mjs           # env + live probes + READY banner
 *   node scripts/validate-pre-rollout.mjs --full    # also runs validate:pre-deploy + validate:pre-rollout
 *
 * Environment:
 *   MERLIN_BASE_URL — optional staging/production URL for live /api/status (and /api/health) probes
 *   MERLIN_HEALTH_COOKIE — optional session cookie for authenticated /api/health checks
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX = '[merlin:pre-rollout]';
const ROOT = process.cwd();
const FULL = process.argv.includes('--full');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const failures = [];
const warnings = [];

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

function checkProductionSecrets() {
  const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY?.trim();
  if (!dataEncryptionKey || dataEncryptionKey.length < 32) {
    fail('DATA_ENCRYPTION_KEY is missing or shorter than 32 characters');
  } else {
    pass('DATA_ENCRYPTION_KEY is configured');
  }

  const searchHmacKey = process.env.SEARCH_HMAC_KEY?.trim();
  if (!searchHmacKey || searchHmacKey.length < 32) {
    fail('SEARCH_HMAC_KEY is missing or shorter than 32 characters');
  } else {
    pass('SEARCH_HMAC_KEY is configured');
  }

  const kvUrl = process.env.KV_REST_API_URL?.trim();
  const kvToken = process.env.KV_REST_API_TOKEN?.trim();
  if (!kvUrl || !kvToken) {
    fail('KV_REST_API_URL and KV_REST_API_TOKEN are required for production distributed rate limiting');
  } else {
    pass('KV_REST_API_URL + KV_REST_API_TOKEN are configured');
  }

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!sentryDsn) {
    // Non-blocking: local/CI ready-to-deploy stays green; set on Vercel for production.
    warn('NEXT_PUBLIC_SENTRY_DSN is not set — production error monitoring will be disabled until configured');
  } else {
    pass('NEXT_PUBLIC_SENTRY_DSN is configured');
  }

  if (!process.env.DATABASE_URL?.trim()) {
    fail('DATABASE_URL is not set');
  } else {
    pass('DATABASE_URL is configured');
  }

  if (!process.env.SESSION_SECRET?.trim()) {
    fail('SESSION_SECRET is not set');
  } else {
    pass('SESSION_SECRET is configured');
  }
}

async function pingEndpoint(label, url, options = {}, tolerateStatuses = []) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(20_000),
    });
    const elapsed = Date.now() - started;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok) {
      if (tolerateStatuses.includes(res.status)) {
        warn(`${label} → HTTP ${res.status} (${elapsed}ms) ${url}`);
        return false;
      }
      fail(`${label} → HTTP ${res.status} (${elapsed}ms) ${url}`);
      return false;
    }

    pass(`${label} → HTTP ${res.status} (${elapsed}ms) ${url}`);
    if (label.includes('/api/status') && body && typeof body === 'object') {
      if (body.maintenance === true) {
        warn('/api/status reports maintenance: true — deployment may be in maintenance window');
      }
      if (body.version) {
        console.log(`${PREFIX}     version=${body.version} buildCommit=${body.buildCommit ?? 'n/a'}`);
      }
    }
    if (label.includes('/api/health') && body && typeof body === 'object') {
      if (body.status === 'error') {
        fail(`/api/health returned status=error`);
        return false;
      }
      if (body.status === 'degraded') {
        warn(`/api/health returned status=degraded`);
      }
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(message)) {
      warn(`${label} unreachable: ${message} (${url})`);
      return false;
    }
    fail(`${label} unreachable: ${message} (${url})`);
    return false;
  }
}

async function checkLiveEndpoints() {
  if (!process.env.MERLIN_BASE_URL?.trim()) {
    warn(
      'MERLIN_BASE_URL not set — skipping live /api/status and /api/health probes (set MERLIN_BASE_URL for staging/production URL checks)'
    );
    return;
  }

  const baseUrl = process.env.MERLIN_BASE_URL.replace(/\/$/, '');

  await pingEndpoint('GET /api/status', `${baseUrl}/api/status`);

  const healthHeaders = {};
  const healthCookie = process.env.MERLIN_HEALTH_COOKIE?.trim();
  if (healthCookie) {
    healthHeaders.cookie = healthCookie;
  }

  const tolerated = healthCookie ? [] : [401, 403];
  const healthOk = await pingEndpoint(
    'GET /api/health',
    `${baseUrl}/api/health`,
    { headers: healthHeaders },
    tolerated
  );
  if (!healthOk && !healthCookie) {
    warn(
      '/api/health requires manager auth — set MERLIN_HEALTH_COOKIE for a full health probe (validate:pre-rollout already runs in-process checks)'
    );
  }
}

function runExistingValidations() {
  console.log(`${PREFIX} Running validate:pre-deploy...`);
  execSync('npm run validate:pre-deploy', { stdio: 'inherit', cwd: ROOT });
  console.log(`${PREFIX} Running validate:pre-rollout...`);
  execSync('npm run validate:pre-rollout', { stdio: 'inherit', cwd: ROOT });
}

function printReadyBanner() {
  console.log('');
  console.log(`${GREEN}╔══════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}║  READY — Merlin passed pre-rollout deployment checks         ║${RESET}`);
  console.log(`${GREEN}╚══════════════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
  console.log(`${GREEN}Next:${RESET} npm run db:migrate-pii-safe  (dry-run S2 backfill before production data migration)`);
  console.log('');
}

async function main() {
  console.log(`${PREFIX} Read-only pre-rollout validation starting...`);

  loadDotEnvFile('.env');
  loadDotEnvFile('.env.local');
  loadDotEnvFile('.env.production');

  if (FULL) {
    runExistingValidations();
  }

  checkProductionSecrets();
  await checkLiveEndpoints();

  if (failures.length > 0) {
    console.error(`${PREFIX} ${failures.length} check(s) failed — not ready to deploy.`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`${PREFIX} ${warnings.length} warning(s) — review before deploying.`);
  }

  printReadyBanner();
}

main().catch((error) => {
  console.error(`${PREFIX} Unexpected error:`, error);
  process.exit(1);
});