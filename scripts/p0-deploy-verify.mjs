#!/usr/bin/env node
/**
 * P0 Deploy Verification — automates the Production Attack Plan P0 checklist.
 *
 * Layers:
 *   1. Code / binding gates (always) — fail CI if broken
 *   2. Optional live probes when MERLIN_BASE_URL is set
 *   3. Optional authenticated Health matrix when MERLIN_HEALTH_COOKIE is set
 *
 * Usage:
 *   node scripts/p0-deploy-verify.mjs
 *   node scripts/p0-deploy-verify.mjs --live
 *   MERLIN_BASE_URL=https://… MERLIN_HEALTH_COOKIE='benz_tech_session=…' node scripts/p0-deploy-verify.mjs --live
 *   node scripts/p0-deploy-verify.mjs --json
 *
 * Exit codes:
 *   0 = P0 code gates pass (live warnings do not fail unless --strict-live)
 *   1 = critical code gate failure
 *   2 = --strict-live and live health critical failed
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = process.cwd();
const PREFIX = '[merlin:p0-verify]';
const LIVE = process.argv.includes('--live') || process.env.MERLIN_P0_LIVE === '1';
const STRICT_LIVE = process.argv.includes('--strict-live');
const AS_JSON = process.argv.includes('--json');
const OUT_DIR = resolve(ROOT, 'docs/generated');
const OUT_MD = resolve(OUT_DIR, 'p0-deploy-verify-latest.md');
const OUT_JSON = resolve(OUT_DIR, 'p0-deploy-verify-latest.json');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** @type {Array<{ id: string, name: string, status: 'pass'|'fail'|'warn'|'skip', detail: string, critical: boolean }>} */
const results = [];

function loadDotEnvFile(filename) {
  const path = resolve(ROOT, filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function record(id, name, status, detail, critical = true) {
  results.push({ id, name, status, detail, critical });
  const color =
    status === 'pass' ? GREEN : status === 'fail' ? RED : status === 'warn' ? YELLOW : DIM;
  const tag = status.toUpperCase().padEnd(4);
  if (!AS_JSON) {
    console.log(`${PREFIX} ${color}${tag}${RESET} ${id} — ${name}: ${detail}`);
  }
}

function read(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function runNpmScript(script) {
  try {
    execSync(`npm run ${script}`, {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      env: process.env,
    });
    return { ok: true, output: '' };
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || error.message || ''}`;
    return { ok: false, output: output.slice(0, 800) };
  }
}

function checkCodeGates() {
  // P0-1 / P0-2 code: KV binding resolution + wrangler
  const workersKv = read('src/lib/storage/workersKv.ts') || '';
  if (workersKv.includes('getCloudflareContext') && workersKv.includes('KV_STORE')) {
    record(
      'P0-1',
      'KV binding resolution code',
      'pass',
      'workersKv resolves KV_STORE via getCloudflareContext'
    );
  } else {
    record(
      'P0-1',
      'KV binding resolution code',
      'fail',
      'src/lib/storage/workersKv.ts missing getCloudflareContext / KV_STORE path'
    );
  }

  const wrangler = read('wrangler.toml') || '';
  const hasKv = /binding\s*=\s*"KV_STORE"/.test(wrangler);
  const hasDb = /binding\s*=\s*"DB"/.test(wrangler);
  const hasR2 = /binding\s*=\s*"APEX_R2"/.test(wrangler);
  const hasQueue = /binding\s*=\s*"AI_JOBS_QUEUE"/.test(wrangler);
  if (hasKv && hasDb && hasR2) {
    record(
      'P0-2a',
      'wrangler.toml bindings',
      'pass',
      `KV_STORE=${hasKv} DB=${hasDb} APEX_R2=${hasR2} AI_JOBS_QUEUE=${hasQueue}`
    );
  } else {
    record(
      'P0-2a',
      'wrangler.toml bindings',
      'fail',
      `Missing bindings — KV_STORE=${hasKv} DB=${hasDb} APEX_R2=${hasR2}`
    );
  }
  if (!hasQueue) {
    record(
      'P0-5a',
      'AI queue producer binding',
      'warn',
      'AI_JOBS_QUEUE not in wrangler.toml — durable AI may be unbound',
      false
    );
  } else {
    record('P0-5a', 'AI queue producer binding', 'pass', 'AI_JOBS_QUEUE present in wrangler.toml', false);
  }

  // MFA health code
  const health = read('src/lib/healthChecks.ts') || '';
  if (
    health.includes('checkMfaPolicyHealth') &&
    health.includes('operatorMessage') &&
    health.includes('MERLIN_MFA_ENFORCE')
  ) {
    record(
      'P0-3',
      'MFA health probe code',
      'pass',
      'Enrollment-aware MFA health + operatorMessage present'
    );
  } else {
    record(
      'P0-3',
      'MFA health probe code',
      'fail',
      'healthChecks MFA probe incomplete'
    );
  }

  // Secrets hygiene scripts
  const seed = runNpmScript('check:seed-secrets');
  record(
    'P0-6a',
    'No seed secrets in repo',
    seed.ok ? 'pass' : 'fail',
    seed.ok ? 'check:seed-secrets clean' : seed.output || 'check:seed-secrets failed'
  );

  const rls = runNpmScript('check:rls-registry');
  record(
    'P0-T',
    'RLS tenant registry',
    rls.ok ? 'pass' : 'fail',
    rls.ok ? 'check:rls-registry clean' : rls.output || 'check:rls-registry failed'
  );

  const api = runNpmScript('check:api-routes');
  record(
    'P0-API',
    'API default-deny wrappers',
    api.ok ? 'pass' : 'fail',
    api.ok ? 'check:api-routes clean' : api.output || 'check:api-routes failed'
  );

  // Env shape (local or CI) — warn if missing, fail only when MERLIN_DEPLOY_GATE=production
  const productionGate =
    process.env.MERLIN_DEPLOY_GATE === 'production' ||
    process.env.MERLIN_P0_REQUIRE_SECRETS === '1';
  const session = process.env.SESSION_SECRET?.trim() || '';
  const dek = process.env.DATA_ENCRYPTION_KEY?.trim() || '';
  const hmac = process.env.SEARCH_HMAC_KEY?.trim() || '';
  const grok = process.env.GROK_API_KEY?.trim() || '';
  const secretChecks = [
    ['SESSION_SECRET', session.length >= 32],
    ['DATA_ENCRYPTION_KEY', dek.length >= 32],
    ['SEARCH_HMAC_KEY', hmac.length >= 32],
    ['GROK_API_KEY', grok.length > 8],
  ];
  for (const [name, ok] of secretChecks) {
    if (ok) {
      record(`P0-6-${name}`, name, 'pass', 'present (length ok)', false);
    } else if (productionGate) {
      record(`P0-6-${name}`, name, 'fail', 'missing or too short for production gate');
    } else {
      record(
        `P0-6-${name}`,
        name,
        'warn',
        'not set in this environment (ok for code-only P0; required on Worker)',
        false
      );
    }
  }

  const ownerSeed = Object.keys(process.env).filter((k) =>
    /^OWNER_SEED_PASSWORD/i.test(k)
  );
  if (ownerSeed.length && productionGate) {
    record(
      'P0-6b',
      'OWNER_SEED_PASSWORD* absent',
      'fail',
      `Found ${ownerSeed.join(', ')} — remove from production Worker`
    );
  } else if (ownerSeed.length) {
    record(
      'P0-6b',
      'OWNER_SEED_PASSWORD* absent',
      'warn',
      `Present in env: ${ownerSeed.join(', ')} — must not ship on production Worker`,
      false
    );
  } else {
    record('P0-6b', 'OWNER_SEED_PASSWORD* absent', 'pass', 'not set in this environment', false);
  }

  // Attack plan + matrix artifacts
  if (existsSync(resolve(ROOT, 'docs/PRODUCTION-ATTACK-PLAN.md'))) {
    record('P0-DOC', 'Production Attack Plan', 'pass', 'docs/PRODUCTION-ATTACK-PLAN.md present', false);
  } else {
    record('P0-DOC', 'Production Attack Plan', 'warn', 'attack plan doc missing', false);
  }

  // Capability matrix generation must work
  try {
    execSync('node scripts/generate-capability-matrix.mjs', {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    record('P0-MATRIX', 'Capability matrix generate', 'pass', 'docs/generated/capability-matrix.json', false);
  } catch (error) {
    record(
      'P0-MATRIX',
      'Capability matrix generate',
      'fail',
      error.message || 'matrix generate failed',
      false
    );
  }
}

async function checkLive() {
  const base = (process.env.MERLIN_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    record(
      'P0-LIVE',
      'Live base URL',
      'skip',
      'Set MERLIN_BASE_URL and pass --live to probe deployment',
      false
    );
    return;
  }

  // Public status
  try {
    const res = await fetch(`${base}/api/status`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      record('P0-LIVE-STATUS', 'GET /api/status', 'pass', `HTTP ${res.status}`, false);
    } else {
      record('P0-LIVE-STATUS', 'GET /api/status', 'warn', `HTTP ${res.status}`, false);
    }
  } catch (error) {
    record(
      'P0-LIVE-STATUS',
      'GET /api/status',
      'fail',
      error instanceof Error ? error.message : String(error),
      STRICT_LIVE
    );
  }

  const cookie = process.env.MERLIN_HEALTH_COOKIE?.trim();
  if (!cookie) {
    record(
      'P0-LIVE-HEALTH',
      'Authenticated /api/health',
      'skip',
      'Set MERLIN_HEALTH_COOKIE for manager session probe',
      false
    );
    return;
  }

  try {
    const res = await fetch(`${base}/api/health`, {
      headers: {
        Accept: 'application/json',
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    const services = body.services || {};
    const kv = services.kv?.status;
    const mfa = services.mfaPolicy?.status;
    const queue = services.aiJobsQueue?.status;
    const seeds = services.ownerSeedSecrets?.status;
    const db = services.database?.status;

    const crit = [
      ['kv', kv],
      ['database', db],
      ['ownerSeedSecrets', seeds],
      ['aiJobsQueue', queue],
    ];

    for (const [name, st] of crit) {
      if (st === 'ok') {
        record(`P0-LIVE-${name}`, `Health ${name}`, 'pass', `status=${st}`, name === 'kv' || name === 'database');
      } else if (st === 'warn') {
        record(
          `P0-LIVE-${name}`,
          `Health ${name}`,
          'warn',
          `${st}${services[name]?.operatorMessage ? ` — ${services[name].operatorMessage}` : ''}`,
          false
        );
      } else if (st) {
        record(
          `P0-LIVE-${name}`,
          `Health ${name}`,
          'fail',
          `${st}${services[name]?.operatorMessage ? ` — ${services[name].operatorMessage}` : ''}`,
          name === 'kv' || name === 'database' || name === 'ownerSeedSecrets'
        );
      } else {
        record(
          `P0-LIVE-${name}`,
          `Health ${name}`,
          'warn',
          `missing from payload (HTTP ${res.status})`,
          false
        );
      }
    }

    if (mfa === 'ok') {
      record('P0-LIVE-mfa', 'Health mfaPolicy', 'pass', services.mfaPolicy?.operatorMessage || 'ok', false);
    } else if (mfa === 'warn') {
      record(
        'P0-LIVE-mfa',
        'Health mfaPolicy',
        'warn',
        services.mfaPolicy?.operatorMessage || 'warn — enroll managers or set MERLIN_MFA_ENFORCE',
        false
      );
    } else {
      record('P0-LIVE-mfa', 'Health mfaPolicy', 'warn', `status=${mfa || 'missing'}`, false);
    }

    if (!res.ok && res.status === 503) {
      record('P0-LIVE-HTTP', 'Health HTTP status', 'fail', '503 — critical dependency down');
    } else {
      record('P0-LIVE-HTTP', 'Health HTTP status', 'pass', `HTTP ${res.status}`, false);
    }
  } catch (error) {
    record(
      'P0-LIVE-HEALTH',
      'Authenticated /api/health',
      'fail',
      error instanceof Error ? error.message : String(error),
      STRICT_LIVE
    );
  }
}

function writeReports() {
  mkdirSync(OUT_DIR, { recursive: true });
  const criticalFails = results.filter((r) => r.status === 'fail' && r.critical);
  const warns = results.filter((r) => r.status === 'warn');
  const passes = results.filter((r) => r.status === 'pass');
  const payload = {
    generatedAt: new Date().toISOString(),
    summary: {
      pass: passes.length,
      warn: warns.length,
      fail: results.filter((r) => r.status === 'fail').length,
      skip: results.filter((r) => r.status === 'skip').length,
      criticalFails: criticalFails.length,
    },
    results,
    verdict:
      criticalFails.length === 0
        ? 'P0_CODE_GATES_PASS'
        : 'P0_CODE_GATES_FAIL',
  };
  writeFileSync(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`);

  const lines = [
    '# P0 Deploy Verify — latest run',
    '',
    `**Generated:** ${payload.generatedAt}`,
    `**Verdict:** \`${payload.verdict}\``,
    '',
    `| Pass | Warn | Fail | Skip | Critical fails |`,
    `|------|------|------|------|----------------|`,
    `| ${payload.summary.pass} | ${payload.summary.warn} | ${payload.summary.fail} | ${payload.summary.skip} | ${payload.summary.criticalFails} |`,
    '',
    '## Results',
    '',
    '| ID | Status | Check | Detail |',
    '|----|--------|-------|--------|',
  ];
  for (const r of results) {
    lines.push(
      `| ${r.id} | \`${r.status}\` | ${r.name} | ${(r.detail || '').replace(/\|/g, '/')} |`
    );
  }
  lines.push('');
  lines.push('## Next ops steps if live not green');
  lines.push('');
  lines.push('1. Redeploy Worker after KV binding code fix.');
  lines.push('2. Confirm `wrangler.toml` `KV_STORE` namespace id in Cloudflare dashboard.');
  lines.push('3. Enroll managers in MFA Settings; then set `MERLIN_MFA_ENFORCE=true`.');
  lines.push('4. Bind AI queue consumer; watch Control Center queueSignal.');
  lines.push('5. Remove any `OWNER_SEED_PASSWORD*` from production secrets.');
  lines.push('');
  lines.push('*Re-run: `npm run verify:p0` or `npm run verify:p0 -- --live`*');
  lines.push('');
  writeFileSync(OUT_MD, lines.join('\n'));
  return payload;
}

async function main() {
  loadDotEnvFile('.env.local');
  loadDotEnvFile('.env');

  if (!AS_JSON) {
    console.log(`${PREFIX} P0 deploy verification starting…`);
  }

  checkCodeGates();
  if (LIVE) {
    await checkLive();
  } else {
    record(
      'P0-LIVE',
      'Live probes',
      'skip',
      'Pass --live with MERLIN_BASE_URL to probe deployment',
      false
    );
  }

  const payload = writeReports();

  if (AS_JSON) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(
      `${PREFIX} report: ${relative(ROOT, OUT_MD)} · verdict=${payload.verdict}`
    );
  }

  if (payload.summary.criticalFails > 0) process.exit(1);
  if (STRICT_LIVE && results.some((r) => r.status === 'fail' && String(r.id).startsWith('P0-LIVE'))) {
    process.exit(2);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(`${PREFIX} fatal`, error);
  process.exit(1);
});
