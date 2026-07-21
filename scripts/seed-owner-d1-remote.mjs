/**
 * One-shot: seed national owner into remote D1 (Cloudflare).
 * Reads OWNER_SEED_* from .owner-seed.local.env (gitignored) or process.env.
 *
 * Usage: node scripts/seed-owner-d1-remote.mjs
 *
 * P0 AFTER SUCCESS:
 *   1. Delete .owner-seed.local.env from disk (do not commit)
 *   2. Ensure Worker has NO OWNER_SEED_PASSWORD* secrets:
 *        npx wrangler secret delete OWNER_SEED_PASSWORD
 *   3. Set APEX_PLATFORM_OWNER_EMAILS for ongoing national operators
 *   4. Confirm manager /api/health ownerSeedSecrets is ok
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

const NATIONAL_ID = '__apex_national__';
const NATIONAL_NAME = 'Apex National Platform';
const PRIMARY_ID = 'seed-dealership';
const SECOND_ID = 'seed-dealership-2';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    let v = t.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function main() {
  const fileEnv = {
    ...loadEnvFile(resolve(process.cwd(), '.env.local')),
    ...loadEnvFile(resolve(process.cwd(), '.owner-seed.local.env')),
  };
  const email = (process.env.OWNER_SEED_EMAIL || fileEnv.OWNER_SEED_EMAIL || '')
    .trim()
    .toLowerCase();
  const password = (process.env.OWNER_SEED_PASSWORD || fileEnv.OWNER_SEED_PASSWORD || '').trim();
  const name = (process.env.OWNER_SEED_NAME || fileEnv.OWNER_SEED_NAME || 'National Owner').trim();

  if (!email.includes('@') || !password || password.length < 8) {
    console.error('[seed-owner-d1] Missing OWNER_SEED_EMAIL / OWNER_SEED_PASSWORD');
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  const id =
    'owner_' + createHash('sha256').update(email).digest('hex').slice(0, 16);
  const now = new Date().toISOString();

  // SQLite booleans as 0/1; TechnicianRole enum value is string 'owner'
  const sql = `
INSERT OR IGNORE INTO "Dealership" ("id", "name", "timezone", "story_brand", "createdAt")
VALUES ('${NATIONAL_ID}', '${esc(NATIONAL_NAME)}', 'America/New_York', 'mercedes', '${now}');

INSERT OR IGNORE INTO "Dealership" ("id", "name", "timezone", "story_brand", "createdAt")
VALUES ('${PRIMARY_ID}', 'Staging - Mercedes-Benz Dealers', 'America/New_York', 'mercedes', '${now}');

INSERT OR IGNORE INTO "Dealership" ("id", "name", "timezone", "story_brand", "createdAt")
VALUES ('${SECOND_ID}', 'Apex Generic Test', 'America/New_York', 'generic', '${now}');

INSERT OR REPLACE INTO "Technician" (
  "id", "email", "d7Number", "apexUsername", "name", "passwordHash",
  "must_change_password", "password_changed_at", "auth_provider", "role",
  "isAdmin", "isActive", "sessionVersion", "dealershipId", "preferred_language",
  "consentAt", "consentVersion", "legalDisclaimerAt", "legalDisclaimerVersion",
  "createdAt", "updatedAt"
) VALUES (
  '${id}',
  '${esc(email)}',
  NULL,
  NULL,
  '${esc(name)}',
  '${esc(hash)}',
  0,
  '${now}',
  'legacy',
  'owner',
  1,
  1,
  0,
  '${NATIONAL_ID}',
  'en',
  '${now}',
  '1.0',
  '${now}',
  '1.0',
  '${now}',
  '${now}'
);
`.trim();

  const sqlPath = resolve(process.cwd(), `.tmp-seed-owner-${randomBytes(4).toString('hex')}.sql`);
  writeFileSync(sqlPath, sql, 'utf8');
  console.log(`[seed-owner-d1] Seeding remote D1 owner=${email} id=${id}`);
  try {
    execSync(`npx wrangler d1 execute merlinus-d1 --remote --file="${sqlPath}"`, {
      stdio: 'inherit',
      env: process.env,
    });
    console.log('[seed-owner-d1] OK');
  } finally {
    try {
      unlinkSync(sqlPath);
    } catch {
      // ignore
    }
  }
}

main();
