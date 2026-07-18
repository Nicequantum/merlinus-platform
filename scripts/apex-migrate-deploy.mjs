#!/usr/bin/env node
/**
 * Legacy Apex Supabase Postgres migrate entrypoint — retired.
 * Merlinus uses Cloudflare D1 exclusively.
 */
console.error('[merlin:apex-migrate] Supabase/Postgres migrate is retired.');
console.error('[merlin:apex-migrate] Use Cloudflare D1:');
console.error('  npx wrangler d1 migrations apply merlinus-d1 --remote');
console.error('  # local: npx wrangler d1 migrations apply merlinus-d1 --local');
console.error('  # or:    RUN_D1_MIGRATE=1 npm run db:migrate:deploy');
process.exit(1);
