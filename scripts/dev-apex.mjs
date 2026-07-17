#!/usr/bin/env node
/** APEX NATIONAL PLATFORM — local dev against live Supabase (.env.apex.local). */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function loadDotEnvFile(filename) {
  const full = path.join(process.cwd(), filename);
  if (!existsSync(full)) return false;
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
    // Do not clobber already-exported shell vars; still allow .env.local base then apex overrides.
    process.env[key] = value;
  }
  return true;
}

// Base Merlin secrets first, then Apex/Supabase overrides.
loadDotEnvFile('.env.local');
const loadedApex = loadDotEnvFile('.env.apex.local');

process.env.APEX_ENV = '1';
// Always force Apex platform mode for this entrypoint (do not inherit merlinus from shell).
process.env.PLATFORM_MODE = 'apex';
process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
process.env.APEX_USE_SUPABASE_DB = process.env.APEX_USE_SUPABASE_DB || 'true';

// Legacy ENCRYPTION_KEY → modern names (same as src/lib/env.ts)
const legacy = process.env.ENCRYPTION_KEY?.trim();
if (legacy && legacy.length >= 32) {
  if (!process.env.DATA_ENCRYPTION_KEY?.trim()) process.env.DATA_ENCRYPTION_KEY = legacy;
  if (!process.env.SEARCH_HMAC_KEY?.trim()) process.env.SEARCH_HMAC_KEY = legacy;
}

const required = ['DATABASE_URL', 'DATA_ENCRYPTION_KEY', 'SEARCH_HMAC_KEY', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(
    `[dev:apex] Missing required env: ${missing.join(', ')}.\n` +
      `  Ensure .env.local has SESSION_SECRET + DATA_ENCRYPTION_KEY + SEARCH_HMAC_KEY\n` +
      `  (or legacy ENCRYPTION_KEY) and .env.apex.local has Supabase connection vars.`
  );
  process.exit(1);
}

if (!loadedApex) {
  console.warn('[dev:apex] .env.apex.local not found — Supabase Apex DB may not be configured.');
} else {
  console.log('[dev:apex] Loaded .env.local + .env.apex.local (APEX_ENV=1, PLATFORM_MODE=apex)');
}

const child = spawn('npx', ['next', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code) => process.exit(code ?? 0));
