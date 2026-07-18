#!/usr/bin/env node
/**
 * Generate a new D1 migration SQL from the Prisma schema using `prisma migrate diff`.
 *
 * Usage:
 *   npm run db:migrate                 # writes migrations/000X_from_schema.sql
 *   node scripts/d1-migrate-diff.mjs my_change_name
 *
 * Apply with:
 *   RUN_D1_MIGRATE=1 npm run db:migrate:deploy
 *   # or: npx wrangler d1 migrations apply merlinus-d1 --local
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const name = (process.argv[2] || 'schema_sync').replace(/[^a-zA-Z0-9_-]/g, '_');
const migrationsDir = join(process.cwd(), 'migrations');

if (!existsSync(migrationsDir)) {
  mkdirSync(migrationsDir, { recursive: true });
}

const existing = readdirSync(migrationsDir)
  .filter((f) => /^\d+_.*\.sql$/i.test(f))
  .sort();
const nextNum = existing.length === 0 ? 1 : Number(existing[existing.length - 1].slice(0, 4)) + 1;
const fileName = `${String(nextNum).padStart(4, '0')}_${name}.sql`;
const outPath = join(migrationsDir, fileName);

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
}

const fromFlag = existsSync(join(process.cwd(), '.wrangler'))
  ? '--from-local-d1'
  : existing.length === 0
    ? '--from-empty'
    : '--from-empty'; // first full dump; follow-ups: prefer --from-local-d1 after apply

console.log(`[d1-diff] Generating ${fileName} (${fromFlag} → schema)…`);

try {
  const sql = execSync(
    `npx prisma migrate diff ${fromFlag} --to-schema-datamodel prisma/schema.prisma --script`,
    { encoding: 'utf8', env: process.env }
  );
  writeFileSync(outPath, sql, 'utf8');
  console.log(`[d1-diff] Wrote ${outPath}`);
  console.log(`[d1-diff] Apply: npx wrangler d1 migrations apply merlinus-d1 --local`);
} catch (error) {
  console.error('[d1-diff] prisma migrate diff failed');
  process.exit(typeof error?.status === 'number' ? error.status : 1);
}
