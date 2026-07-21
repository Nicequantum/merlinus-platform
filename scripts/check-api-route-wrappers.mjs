#!/usr/bin/env node
/**
 * P0-4 — Default-deny: every API route must use an approved wrapper or
 * appear on the intentional bare allowlist in src/lib/apiRoutePolicy.ts.
 *
 * Usage: node scripts/check-api-route-wrappers.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const PREFIX = '[merlin:api-routes]';
const API_ROOT = resolve(ROOT, 'src/app/api');
const POLICY_PATH = resolve(ROOT, 'src/lib/apiRoutePolicy.ts');

function walkRouteFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkRouteFiles(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}

function parsePolicy(source) {
  const wrappers = [];
  for (const m of source.matchAll(/'with\w+\('/g)) {
    wrappers.push(m[0].slice(1, -1)); // withAuth(
  }
  // Fallback known set
  if (wrappers.length === 0) {
    wrappers.push('withAuth(', 'withPublicRoute(', 'withStoryAiRoute(');
  }

  const bare = {};
  const bareBlock = source.match(
    /INTENTIONAL_BARE_API_ROUTES[^=]*=\s*\{([\s\S]*?)\n\}/
  );
  if (bareBlock) {
    const re = /['"](src\/app\/api\/[^'"]+route\.ts)['"]\s*:/g;
    let m;
    while ((m = re.exec(bareBlock[1])) !== null) {
      bare[m[1]] = true;
    }
  }
  return { wrappers, bare };
}

function main() {
  if (!existsSync(POLICY_PATH)) {
    console.error(`${PREFIX} FAIL: missing ${relative(ROOT, POLICY_PATH)}`);
    process.exit(1);
  }
  if (!existsSync(API_ROOT)) {
    console.error(`${PREFIX} FAIL: missing src/app/api`);
    process.exit(1);
  }

  const policySrc = readFileSync(POLICY_PATH, 'utf8');
  const { wrappers, bare } = parsePolicy(policySrc);
  const routes = walkRouteFiles(API_ROOT);
  const failures = [];
  const bareUnused = new Set(Object.keys(bare));

  for (const full of routes) {
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    const src = readFileSync(full, 'utf8');
    const hasWrapper = wrappers.some((w) => src.includes(w));
    if (hasWrapper) {
      if (bare[rel]) bareUnused.delete(rel);
      continue;
    }
    if (bare[rel]) {
      bareUnused.delete(rel);
      continue;
    }
    failures.push(
      `${rel} — no approved wrapper (${wrappers.join(', ')}) and not on INTENTIONAL_BARE_API_ROUTES`
    );
  }

  // Stale allowlist entries
  for (const path of bareUnused) {
    if (!existsSync(resolve(ROOT, path))) {
      failures.push(`INTENTIONAL_BARE allowlist path missing on disk: ${path}`);
    } else {
      // File exists but uses a wrapper now — still ok, warn only
      console.warn(
        `${PREFIX} WARN: ${path} is on bare allowlist but may now use a wrapper — consider removing from allowlist`
      );
    }
  }

  if (failures.length > 0) {
    console.error(`${PREFIX} FAIL: ${failures.length} route policy violation(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      `${PREFIX} Fix: wrap with withAuth/withPublicRoute/withStoryAiRoute, or add to INTENTIONAL_BARE_API_ROUTES with a security reason.`
    );
    process.exit(1);
  }

  console.log(
    `${PREFIX} OK: ${routes.length} API routes — all use approved wrappers or intentional bare allowlist (${Object.keys(bare).length} bare)`
  );
}

main();
