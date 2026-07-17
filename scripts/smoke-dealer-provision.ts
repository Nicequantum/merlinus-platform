#!/usr/bin/env npx tsx
/**
 * Dealer provision smoke checks (PR-P4).
 *
 * Safe by default: static file/source gates + optional dry-run against DB.
 * Does NOT create dealers unless --live is passed with APEX_SMOKE_LIVE=1.
 *
 * Usage:
 *   npm run smoke:dealer-provision
 *   npm run smoke:dealer-provision -- --dry-run-db
 *   APEX_SMOKE_LIVE=1 npm run smoke:dealer-provision -- --live
 *
 * See docs/Apex-Dealer-Onboarding.md → Smoke test.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const failures: string[] = [];
const warnings: string[] = [];

function pass(msg: string): void {
  console.log(`${GREEN}✔${RESET} ${msg}`);
}

function fail(msg: string): void {
  failures.push(msg);
  console.error(`${RED}✖${RESET} ${msg}`);
}

function warn(msg: string): void {
  warnings.push(msg);
  console.warn(`${YELLOW}⚠${RESET} ${msg}`);
}

function mustExist(rel: string): void {
  if (existsSync(resolve(ROOT, rel))) pass(`exists ${rel}`);
  else fail(`missing ${rel}`);
}

function mustMatch(rel: string, pattern: RegExp, label: string): void {
  const full = resolve(ROOT, rel);
  if (!existsSync(full)) {
    fail(`missing ${rel} (${label})`);
    return;
  }
  const src = readFileSync(full, 'utf8');
  if (pattern.test(src)) pass(label);
  else fail(`${label} — pattern not found in ${rel}`);
}

function checkStaticArtifacts(): void {
  console.log(`\n${DIM}▸ Static artifacts${RESET}`);
  mustExist('src/lib/apex/provisionDealer.ts');
  mustExist('src/lib/apex/dealerTemplates.ts');
  mustExist('scripts/provision-dealer.ts');
  mustExist('src/app/api/owner/provision-dealer/route.ts');
  mustExist('src/components/ForcedPasswordChangeScreen.tsx');
  mustExist('docs/Apex-Dealer-Onboarding.md');
  mustExist('tests/unit/provisionDealer.test.ts');
  mustExist('tests/integration/dealer-provision.test.ts');
  mustExist('prisma/migrations/20250713120000_apex_provision_must_change_password/migration.sql');

  mustMatch(
    'src/lib/apex/provisionDealer.ts',
    /export async function provisionDealer/,
    'provisionDealer core export'
  );
  mustMatch(
    'src/lib/apex/provisionDealer.ts',
    /isHttpProvisionEnabled/,
    'HTTP provision flag helper'
  );
  mustMatch(
    'src/app/api/owner/provision-dealer/route.ts',
    /requireOwnerNational:\s*true/,
    'HTTP route requireOwnerNational'
  );
  mustMatch(
    'src/app/api/owner/provision-dealer/route.ts',
    /APEX_ALLOW_HTTP_PROVISION|isHttpProvisionEnabled/,
    'HTTP route env gate'
  );
  mustMatch(
    'src/lib/apiRoute.ts',
    /skipPasswordChange/,
    'apiRoute password-change gate'
  );
  mustMatch(
    'src/app/api/auth/change-password/route.ts',
    /skipPasswordChange:\s*true/,
    'change-password allows forced rotation'
  );
  mustMatch(
    'src/components/BenzTechApp.tsx',
    /needsPasswordChange|ForcedPasswordChangeScreen/,
    'Merlinus forced-password UI gate'
  );
  mustMatch(
    'src/components/apex/ApexPlatformApp.tsx',
    /needsPasswordChange|ForcedPasswordChangeScreen/,
    'Apex forced-password UI gate'
  );
  mustMatch(
    'src/lib/audit.ts',
    /dealer\.provision/,
    'dealer.provision audit action'
  );
  mustMatch(
    'scripts/provision-dealer.ts',
    /FORBIDDEN_PASSWORD_FLAGS/,
    'CLI rejects password argv flags'
  );
}

function checkCliHelpAndPasswordArgv(): void {
  console.log(`\n${DIM}▸ CLI security smoke${RESET}`);
  const help = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './tests/setup/preload.mjs',
      'scripts/provision-dealer.ts',
      '--help',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (help.status === 0 && /manager-password-env|password-stdin|generate-password/i.test(help.stdout)) {
    pass('CLI --help documents secure password channels');
  } else {
    fail(`CLI --help failed or incomplete (status=${help.status})`);
  }

  const bad = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './tests/setup/preload.mjs',
      'scripts/provision-dealer.ts',
      '--code=X',
      '--manager-password=secret',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (bad.status === 2 && /password must not be passed/i.test(bad.stderr + bad.stdout)) {
    pass('CLI rejects --manager-password on argv');
  } else {
    fail(`CLI did not reject argv password (status=${bad.status})`);
  }
}

async function checkDryRunDb(): Promise<void> {
  console.log(`\n${DIM}▸ Dry-run provision (DB-safe)${RESET}`);
  try {
    const { applyResolvedDatabaseEnv } = await import('../src/lib/apex/databaseConfig');
    applyResolvedDatabaseEnv();
    const { provisionDealer } = await import('../src/lib/apex/provisionDealer');
    const result = await provisionDealer({
      dealerCode: 'SMOKEDRY',
      dealerName: 'Smoke Dry Franchise',
      rooftopName: 'Smoke Dry Motors of Riverside',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Smoke Dry Manager',
        email: 'smoke.dry@example.com',
        password: 'Smoke-Dry-Temp-Pass-99',
        d7Number: 'D7SMOKEDRY1',
      },
      dryRun: true,
      actor: { type: 'script', id: 'smoke-dealer-provision' },
    });
    if (result.dryRun && result.mustChangePassword) {
      pass('provisionDealer dry-run OK (mustChangePassword=true)');
    } else {
      fail('provisionDealer dry-run returned unexpected shape');
    }
  } catch (error) {
    fail(`dry-run provision failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkLiveOptional(): Promise<void> {
  console.log(`\n${DIM}▸ Live provision (optional)${RESET}`);
  if (process.env.APEX_SMOKE_LIVE?.trim() !== '1') {
    warn('Skipped live write — set APEX_SMOKE_LIVE=1 and pass --live to create a throwaway dealer');
    return;
  }

  const { applyResolvedDatabaseEnv } = await import('../src/lib/apex/databaseConfig');
  applyResolvedDatabaseEnv();
  const { provisionDealer } = await import('../src/lib/apex/provisionDealer');
  const code = `SMK${Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6)}`;
  const result = await provisionDealer({
    dealerCode: code,
    dealerName: 'Smoke Live Franchise',
    rooftopName: 'Smoke Live Motors of Riverside',
    templateId: 'mercedes-rooftop-v1',
    manager: {
      name: 'Smoke Live Manager',
      email: `smoke.live.${code.toLowerCase()}@example.com`,
      password: 'Smoke-Live-Temp-Pass-88',
      d7Number: `D7${code}`.slice(0, 16),
    },
    actor: { type: 'script', id: 'smoke-dealer-provision-live' },
  });
  if (result.created && result.mustChangePassword) {
    pass(`live provision created dealerCode=${result.dealerCode} dealershipId=${result.dealershipId}`);
    console.log(
      `${DIM}  Clean up manually if needed: dealer ${result.dealerId} / manager ${result.managerId}${RESET}`
    );
  } else {
    fail(`live provision did not create (skipped=${result.skipped} dryRun=${result.dryRun})`);
  }
}

function printManualChecklist(): void {
  console.log(`\n${DIM}▸ Manual UI checklist (operator)${RESET}`);
  console.log(`  1. npm run dev:apex`);
  console.log(`  2. Provision a manager (CLI or HTTP with APEX_ALLOW_HTTP_PROVISION=true)`);
  console.log(`  3. Login → forced password screen (data-testid=forced-password-change)`);
  console.log(`  4. Change password → re-login → workspace`);
  console.log(`  Full steps: docs/Apex-Dealer-Onboarding.md`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRunDb = argv.includes('--dry-run-db') || argv.includes('--all');
  const live = argv.includes('--live');

  console.log('\nDealer provision smoke (PR-P4)\n');

  checkStaticArtifacts();
  checkCliHelpAndPasswordArgv();

  if (dryRunDb || live) {
    await checkDryRunDb();
  } else {
    console.log(`\n${DIM}▸ Dry-run DB skipped (pass --dry-run-db)${RESET}`);
  }

  if (live) {
    await checkLiveOptional();
  }

  printManualChecklist();

  console.log('');
  if (failures.length) {
    console.error(`${RED}SMOKE FAIL${RESET}: ${failures.length} issue(s)`);
    process.exit(1);
  }
  if (warnings.length) {
    console.log(`${YELLOW}SMOKE PASS with warnings${RESET}: ${warnings.length}`);
  } else {
    console.log(`${GREEN}SMOKE PASS${RESET}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
