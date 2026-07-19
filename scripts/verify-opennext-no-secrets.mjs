#!/usr/bin/env node
/**
 * CI guard: fail if OpenNext output embeds runtime-only secret keys.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNTIME_ONLY_SECRET_NAMES } from './secret-env-names.mjs';

const TARGET = resolve(process.cwd(), '.open-next/cloudflare/next-env.mjs');
const PREFIX = '[merlin:verify-secrets]';

if (!existsSync(TARGET)) {
  console.log(`${PREFIX} skip — no next-env.mjs yet`);
  process.exit(0);
}

const body = readFileSync(TARGET, 'utf8');
const hits = RUNTIME_ONLY_SECRET_NAMES.filter((name) => body.includes(`"${name}"`));
if (hits.length > 0) {
  console.error(`${PREFIX} FAIL — secrets must not be baked into Worker env bundle:`);
  for (const h of hits) console.error(`  - ${h}`);
  console.error(`${PREFIX} Run: node scripts/strip-opennext-secrets.mjs after opennext build`);
  process.exit(1);
}
console.log(`${PREFIX} OK — no runtime secret keys in next-env.mjs`);
