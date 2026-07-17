#!/usr/bin/env node
/**
 * Secure Apex dealer provision CLI.
 *
 * Password rules (hard):
 *  - Never pass password on the command line
 *  - Use --manager-password-env=VAR, --password-stdin, or interactive prompt
 *  - Credentials only printed with --show-credentials (stderr)
 *
 * Naming:
 *  - --rooftop-name is Dealership.name (UI: national list + dealership header)
 *  - --dealer-name is Dealer.name (franchise)
 *  - --code is Dealer.code (ops id)
 */
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output, stderr } from 'node:process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnvFile(filename: string, override = true): void {
  const full = path.join(process.cwd(), filename);
  if (!existsSync(full)) return;
  for (const line of readFileSync(full, 'utf8').split('\n')) {
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
    if (override || !process.env[key]?.trim()) process.env[key] = value;
  }
}

loadDotEnvFile('.env.local', false);
loadDotEnvFile('.env.apex.local', true);
process.env.APEX_ENV = process.env.APEX_ENV || '1';
if (!process.env.PLATFORM_MODE?.trim()) process.env.PLATFORM_MODE = 'apex';
if (!process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim()) {
  process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
}

type FlagMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): FlagMap {
  const flags: FlagMap = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') continue;
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument "${arg}". Use --flag=value form only.`);
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      flags[body] = true;
      continue;
    }
    const key = body.slice(0, eq);
    const value = body.slice(eq + 1);
    flags[key] = value;
  }
  return flags;
}

const FORBIDDEN_PASSWORD_FLAGS = [
  'manager-password',
  'password',
  'pass',
  'pwd',
  'manager-pass',
  'manager_password',
];

async function readPasswordInteractive(prompt: string): Promise<string> {
  if (!input.isTTY) {
    throw new Error(
      'Interactive password prompt requires a TTY. Use --password-stdin or --manager-password-env.'
    );
  }
  return new Promise((resolve, reject) => {
    const stdin = input as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    const wasRaw = stdin.isRaw;
    if (typeof stdin.setRawMode === 'function') stdin.setRawMode(true);

    output.write(prompt);
    let buf = '';
    const onData = (chunk: Buffer | string) => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\n' || ch === '\r') {
          cleanup();
          output.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    const cleanup = () => {
      input.removeListener('data', onData);
      if (typeof stdin.setRawMode === 'function') stdin.setRawMode(Boolean(wasRaw));
    };
    input.on('data', onData);
  });
}

async function readPasswordFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

function readPasswordFromEnv(varName: string): string {
  if (!/^[A-Z][A-Z0-9_]{2,64}$/.test(varName)) {
    throw new Error('Invalid --manager-password-env name (use A-Z, 0-9, _).');
  }
  const value = process.env[varName];
  if (!value?.length) {
    throw new Error(`Environment variable ${varName} is empty or unset.`);
  }
  return value;
}

async function confirmProvision(
  dealerCode: string,
  rooftopName: string,
  dealerName: string
): Promise<void> {
  if (!input.isTTY) {
    throw new Error('Non-interactive shell requires --yes and APEX_PROVISION_ALLOW_YES=1.');
  }
  const rl = createInterface({ input, output });
  const question = (q: string) =>
    new Promise<string>((resolve) => {
      rl.question(q, resolve);
    });

  console.log('');
  console.log('About to provision:');
  console.log(`  Dealer code:     ${dealerCode}`);
  console.log(`  Franchise:       ${dealerName}`);
  console.log(`  Rooftop display: ${rooftopName}`);
  console.log('  (Rooftop display name appears in national console + dealership header)');
  console.log('');
  const answer = await question(`Type the dealer code (${dealerCode}) to confirm: `);
  rl.close();
  if (answer.trim().toUpperCase() !== dealerCode.toUpperCase()) {
    throw new Error('Confirmation did not match dealer code — aborted.');
  }
}

function printHelp(): void {
  console.log(`
Secure Apex dealer provision

Templates (all inherit clean base — no pilot name/logo bleed):
  base-rooftop-v1       Clean empty start (email login, no logo/brand)
  mercedes-rooftop-v1   Extends base + D7 + Xentry (Mercedes-only deltas)
  generic-rooftop-v1    Extends base + apex username (multi-brand)

Usage (Mercedes):
  npm run provision-dealer -- --code=NEWPORT --dealer-name="..." --rooftop-name="Mercedes-Benz of Newport" \\
    --template=mercedes-rooftop-v1 --manager-name="..." --manager-email=... --manager-d7=D7... \\
    --manager-password-env=NEWPORT_MANAGER_PASSWORD

Usage (clean base):
  npm run provision-dealer -- --code=METRO01 --dealer-name="Metro Auto Group" --rooftop-name="Metro Auto Downtown" \\
    --template=base-rooftop-v1 --manager-name="..." --manager-email=... \\
    --manager-password-env=METRO_MANAGER_PASSWORD

Password (exactly one):
  --manager-password-env=VAR   Read password from env VAR (recommended for CI)
  --password-stdin             Read password from stdin
  --generate-password          CSPRNG temp password (use with --show-credentials)
  (default if TTY)             Interactive hidden prompt

Naming:
  --rooftop-name is Dealership.name (UI header) — required, never from template
  --dealer-name is Dealer.name (franchise) — required, never from template
  Pilot labels (Merlinus / Tiverton pilot / VITI) are rejected

Security:
  Passwords MUST NOT appear on the command line.
  --show-credentials           Print manager identifiers to stderr (opt-in)
  --yes                        Skip confirm (requires APEX_PROVISION_ALLOW_YES=1)
  --dry-run                    Validate structure (uses disposable password)
  --if-exists=fail|skip|update-metadata
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let flags: FlagMap;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
    return;
  }

  for (const bad of FORBIDDEN_PASSWORD_FLAGS) {
    if (bad in flags) {
      console.error(
        `Security: password must not be passed via --${bad}. Use --manager-password-env, --password-stdin, or interactive prompt.`
      );
      process.exit(2);
      return;
    }
  }

  const { applyResolvedDatabaseEnv } = await import('../src/lib/apex/databaseConfig');
  applyResolvedDatabaseEnv();

  const {
    provisionDealer,
    ProvisionDealerError,
    generateProvisionPassword,
    assertNotProductionWithoutProvisionUrl,
    normalizeDealerCode,
  } = await import('../src/lib/apex/provisionDealer');
  const { listDealerTemplates } = await import('../src/lib/apex/dealerTemplates');
  const { prisma } = await import('../src/lib/db');

  try {
    assertNotProductionWithoutProvisionUrl();

    const code = String(flags.code || '');
    const dealerName = String(flags['dealer-name'] || '');
    const rooftopName = String(flags['rooftop-name'] || '');
    const templateId = String(flags.template || '');
    const managerName = String(flags['manager-name'] || '');
    const managerEmail = String(flags['manager-email'] || '');
    const managerD7 = flags['manager-d7'] ? String(flags['manager-d7']) : undefined;
    const managerUsername = flags['manager-username']
      ? String(flags['manager-username'])
      : undefined;
    const ifExists = String(flags['if-exists'] || 'fail') as 'fail' | 'skip' | 'update-metadata';
    const dryRun = Boolean(flags['dry-run']);
    const showCredentials = Boolean(flags['show-credentials']);
    const yes = Boolean(flags.yes);
    const generatePassword = Boolean(flags['generate-password']);
    const passwordStdin = Boolean(flags['password-stdin']);
    const passwordEnv = flags['manager-password-env']
      ? String(flags['manager-password-env'])
      : undefined;

    if (!code || !dealerName || !rooftopName || !templateId || !managerName || !managerEmail) {
      printHelp();
      throw new Error(
        'Required: --code --dealer-name --rooftop-name --template --manager-name --manager-email'
      );
    }

    if (!listDealerTemplates().some((t) => t.id === templateId)) {
      throw new Error(
        `Unknown template. Choose: ${listDealerTemplates()
          .map((t) => t.id)
          .join(', ')}`
      );
    }

    let password = '';
    const channels = [Boolean(passwordEnv), passwordStdin, generatePassword].filter(Boolean).length;
    if (channels > 1) {
      throw new Error('Use only one of --manager-password-env, --password-stdin, --generate-password.');
    }
    if (passwordEnv) {
      password = readPasswordFromEnv(passwordEnv);
    } else if (passwordStdin) {
      password = await readPasswordFromStdin();
    } else if (generatePassword || dryRun) {
      password = generateProvisionPassword(20);
    } else {
      password = await readPasswordInteractive('Manager password (hidden): ');
      const confirm = await readPasswordInteractive('Confirm password: ');
      if (password !== confirm) {
        throw new Error('Passwords do not match.');
      }
    }
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters.');
    }

    const dealerCodeNorm = normalizeDealerCode(code);
    const generatedPassword = generatePassword ? password : null;

    if (!dryRun && !yes) {
      await confirmProvision(dealerCodeNorm, rooftopName, dealerName);
    } else if (yes && process.env.APEX_PROVISION_ALLOW_YES?.trim() !== '1') {
      throw new Error('--yes requires APEX_PROVISION_ALLOW_YES=1 in the environment.');
    }

    const result = await provisionDealer({
      dealerCode: code,
      dealerName,
      rooftopName,
      templateId,
      manager: {
        name: managerName,
        email: managerEmail,
        password,
        d7Number: managerD7,
        apexUsername: managerUsername,
      },
      ifExists,
      dryRun,
      actor: {
        type: 'script',
        id: process.env.USER || process.env.USERNAME || 'local-operator',
      },
    });

    password = '';

    const safe = {
      created: result.created,
      skipped: result.skipped,
      dryRun: result.dryRun,
      dealerId: result.dealerId,
      dealershipId: result.dealershipId,
      managerId: result.managerId,
      templateId: result.templateId,
      rooftopName: result.rooftopName,
      dealerCode: result.dealerCode,
      auditLogId: result.auditLogId,
      mustChangePassword: result.mustChangePassword,
      logins: result.logins.map((l) => ({
        role: l.role,
        identifierType: l.identifierType,
      })),
    };

    if (flags.json) {
      console.log(JSON.stringify(safe, null, 2));
    } else {
      console.log(
        result.skipped
          ? 'Provision skipped (already exists).'
          : result.dryRun
            ? 'Dry-run OK.'
            : 'Provision succeeded.'
      );
      console.log(`  dealerId:           ${result.dealerId}`);
      console.log(`  dealershipId:       ${result.dealershipId}`);
      console.log(`  managerId:          ${result.managerId || '(n/a)'}`);
      console.log(`  rooftop display:    ${result.rooftopName}`);
      console.log(`  templateId:         ${result.templateId}`);
      console.log(`  auditLogId:         ${result.auditLogId ?? '(none)'}`);
      console.log(`  mustChangePassword: ${result.mustChangePassword}`);
    }

    if (showCredentials && result.created && !result.dryRun) {
      stderr.write('\n--show-credentials (stderr only; store in a password manager)\n');
      if (managerD7) stderr.write(`  manager D7:    ${managerD7}\n`);
      if (managerUsername) stderr.write(`  manager user:  ${managerUsername}\n`);
      stderr.write(`  manager email: ${managerEmail}\n`);
      if (generatedPassword) {
        stderr.write(`  temp password: ${generatedPassword}\n`);
      } else {
        stderr.write('  password:      (the value you supplied — not re-printed)\n');
      }
      stderr.write('  Manager must change password on first login.\n');
    }
  } catch (error) {
    if (error instanceof ProvisionDealerError) {
      console.error(`[${error.code}] ${error.message}`);
      process.exit(error.code === 'PROVISION_DAILY_CAP' ? 3 : 1);
      return;
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main();
