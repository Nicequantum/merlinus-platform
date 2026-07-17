#!/usr/bin/env node
/**
 * Non-secret env presence report for go-live checklist (does not print secret values).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
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

loadDotEnvFile('.env');
loadDotEnvFile('.env.local');
loadDotEnvFile('.env.apex.local');

const KEYS = [
  'DATABASE_URL',
  'DATA_ENCRYPTION_KEY',
  'SEARCH_HMAC_KEY',
  'SESSION_SECRET',
  'GROK_API_KEY',
  'BLOB_READ_WRITE_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SENTRY_DSN',
  'MERLIN_MAINTENANCE_MODE',
  'MODULES_FORCE_ENABLE',
  'VOICE_TWILIO_SKIP_SIGNATURE',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
  'SMS_ENABLED',
  'AUTH_MODE',
  'ADMIN_SEED_PASSWORD',
  'TECH_SEED_PASSWORD',
  'PLATFORM_MODE',
  'APEX_ENV',
  'MERLIN_BASE_URL',
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  'MERLIN_HEALTH_COOKIE',
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
];

const SECRETISH = /KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|SID/;

for (const k of KEYS) {
  const v = process.env[k]?.trim();
  if (!v) {
    console.log(`${k}\tUNSET`);
    continue;
  }
  if (SECRETISH.test(k)) {
    console.log(`${k}\tSET\tlen=${v.length}`);
  } else {
    console.log(`${k}\tSET\t${v.slice(0, 100)}`);
  }
}
