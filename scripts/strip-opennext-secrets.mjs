#!/usr/bin/env node
/**
 * P0: After OpenNext compile, strip runtime-only secrets from next-env.mjs
 * so they are not shipped inside the Worker bundle (use Wrangler secrets instead).
 *
 * Also fails CI if residual secret values remain.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUNTIME_ONLY_SECRET_NAMES } from './secret-env-names.mjs';

const TARGET = resolve(process.cwd(), '.open-next/cloudflare/next-env.mjs');
const PREFIX = '[merlin:strip-secrets]';

if (!existsSync(TARGET)) {
  console.warn(`${PREFIX} skip — ${TARGET} not found (run after opennext build)`);
  process.exit(0);
}

const secretSet = new Set(RUNTIME_ONLY_SECRET_NAMES);
const raw = readFileSync(TARGET, 'utf8');

// next-env.mjs format: export const production = {...};\nexport const development = {...};
const modeRe = /export const (production|development|test) = (\{[\s\S]*?\});/g;
const modes = {};
let match;
while ((match = modeRe.exec(raw)) !== null) {
  const mode = match[1];
  try {
    modes[mode] = JSON.parse(match[2]);
  } catch (e) {
    console.error(`${PREFIX} failed to parse ${mode} env JSON:`, e.message);
    process.exit(1);
  }
}

if (Object.keys(modes).length === 0) {
  console.error(`${PREFIX} no env mode exports found in next-env.mjs`);
  process.exit(1);
}

let stripped = 0;
for (const mode of Object.keys(modes)) {
  const env = modes[mode];
  for (const key of Object.keys(env)) {
    if (key.startsWith('NEXT_PUBLIC_')) continue; // public client vars only
    if (secretSet.has(key)) {
      delete env[key];
      stripped += 1;
      continue;
    }
    // Defense-in-depth: strip unlisted server secrets by name pattern
    if (/(SECRET|PASSWORD|AUTH_TOKEN|API_KEY|SERVICE_ROLE|PRIVATE_KEY)/i.test(key)) {
      delete env[key];
      stripped += 1;
    }
  }
}

const lines = Object.entries(modes).map(
  ([mode, env]) => `export const ${mode} = ${JSON.stringify(env)};`
);
writeFileSync(TARGET, lines.join('\n') + '\n', 'utf8');

// Verify no secret names remain as keys in the file
const after = readFileSync(TARGET, 'utf8');
const residual = RUNTIME_ONLY_SECRET_NAMES.filter((name) => after.includes(`"${name}"`));
if (residual.length > 0) {
  console.error(`${PREFIX} residual secret keys still in next-env.mjs: ${residual.join(', ')}`);
  process.exit(1);
}

console.log(`${PREFIX} stripped ~${stripped} secret entries from next-env.mjs (runtime secrets only via wrangler)`);
