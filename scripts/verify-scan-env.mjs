#!/usr/bin/env node
/**
 * Verifies environment variables required for RO and Xentry photo scanning.
 *
 * Usage:
 *   npm run verify:scan-env
 *   NODE_ENV=production npm run verify:scan-env   # fails if scanning vars missing
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX = '[merlin:scan-env]';
const SCANNING_REQUIRED = ['BLOB_READ_WRITE_TOKEN', 'GROK_API_KEY'];
const FORBIDDEN_PUBLIC_GROK_KEYS = [
  'NEXT_PUBLIC_GROK_API_KEY',
  'NEXT_PUBLIC_XAI_API_KEY',
  'NEXT_PUBLIC_XAI_KEY',
];

const VERCEL_BLOB_SETUP = [
  'Vercel Dashboard → your Merlinus project → Storage tab',
  'Create a Blob store (or open existing) and Connect to Project',
  'Vercel auto-injects BLOB_READ_WRITE_TOKEN into Production, Preview, and Development',
  'Redeploy after connecting the store',
  'Verify: Project → Settings → Environment Variables → BLOB_READ_WRITE_TOKEN',
].join('\n  • ');

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

const isProduction =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const exposedPublicGrokKeys = FORBIDDEN_PUBLIC_GROK_KEYS.filter((key) => process.env[key]?.trim());
if (exposedPublicGrokKeys.length > 0) {
  console.error(`${PREFIX} FORBIDDEN public xAI keys: ${exposedPublicGrokKeys.join(', ')}`);
  console.error(`${PREFIX} Delete these from Vercel. Use server-only GROK_API_KEY only.`);
  process.exit(1);
}

const missing = SCANNING_REQUIRED.filter((key) => !process.env[key]?.trim());

if (missing.length === 0) {
  console.log(`${PREFIX} OK — scanning environment configured (${SCANNING_REQUIRED.join(', ')})`);
  process.exit(0);
}

console.error(`${PREFIX} Missing required scanning variables: ${missing.join(', ')}`);
console.error(`${PREFIX} RO scanning and Xentry photo analysis cannot work without these.`);

if (missing.includes('BLOB_READ_WRITE_TOKEN')) {
  console.error(`${PREFIX} BLOB_READ_WRITE_TOKEN setup:\n  • ${VERCEL_BLOB_SETUP}`);
}

if (missing.includes('GROK_API_KEY')) {
  console.error(
    `${PREFIX} GROK_API_KEY: server-only xAI key (Project → Settings → Environment Variables). Never use NEXT_PUBLIC_* variants.`
  );
}

if (isProduction) {
  process.exit(1);
}

console.warn(`${PREFIX} Non-production build — continuing with scanning disabled.`);
process.exit(0);