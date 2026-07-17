#!/usr/bin/env node
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

loadDotEnvFile('.env.local');
loadDotEnvFile('.env.apex.local');

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid';
  }
}

const db = process.env.DATABASE_URL || '';
const enc = process.env.DATA_ENCRYPTION_KEY || '';
const search = process.env.SEARCH_HMAC_KEY || '';
const session = process.env.SESSION_SECRET || '';
const grok = process.env.GROK_API_KEY || '';
const blob = process.env.BLOB_READ_WRITE_TOKEN || '';
const kv = process.env.KV_REST_API_URL || '';
const sentry = process.env.NEXT_PUBLIC_SENTRY_DSN || '';

console.log(
  JSON.stringify(
    {
      db_host: hostOf(db),
      encryption_hex64: /^[0-9a-fA-F]{64}$/.test(enc),
      search_hex64: /^[0-9a-fA-F]{64}$/.test(search),
      keys_differ: enc !== search && enc.length > 0,
      session_len: session.length,
      grok_looks_placeholder:
        /your-|example|changeme|xxx/i.test(grok) || grok.length < 20,
      blob_looks_placeholder:
        /your-|example/i.test(blob) || blob.length < 30,
      kv_looks_placeholder: /your-kv|example/i.test(kv),
      sentry_looks_placeholder: /your-key@o0|example/i.test(sentry),
      app_url: process.env.NEXT_PUBLIC_APP_URL || '',
      twilio_sid_set: Boolean(process.env.TWILIO_ACCOUNT_SID?.trim()),
      modules_force: process.env.MODULES_FORCE_ENABLE || '',
      voice_skip: process.env.VOICE_TWILIO_SKIP_SIGNATURE || '',
    },
    null,
    2
  )
);
