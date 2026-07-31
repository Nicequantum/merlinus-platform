#!/usr/bin/env node
/**
 * Living capability matrix generator.
 *
 * Scans every src/app/api route.ts for auth wrappers, requireModule, role gates.
 * Merges hand overrides from src/lib/capabilityMatrix/overrides.ts (parsed lightly).
 *
 * Usage:
 *   node scripts/generate-capability-matrix.mjs
 *   node scripts/generate-capability-matrix.mjs --check   # fail if docs/generated is stale
 *
 * Outputs:
 *   docs/generated/capability-matrix.json
 *   docs/generated/CAPABILITY-MATRIX.md
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const API_ROOT = resolve(ROOT, 'src/app/api');
const OUT_DIR = resolve(ROOT, 'docs/generated');
const JSON_OUT = join(OUT_DIR, 'capability-matrix.json');
const MD_OUT = join(OUT_DIR, 'CAPABILITY-MATRIX.md');
const OVERRIDES_PATH = resolve(ROOT, 'src/lib/capabilityMatrix/overrides.ts');
const CHECK = process.argv.includes('--check');
const PREFIX = '[merlin:capability-matrix]';

const PILOT_STATUS_LEGEND = {
  'pilot-core': 'Required for first MB pilot (core warranty story)',
  'pilot-optional': 'Enable only if contracted / journey-proven',
  'ops-gated': 'Needs Worker secrets / queue / external service healthy',
  deferred: 'Not shipping — do not sell as live',
  'national-owner': 'National / group owner only',
  internal: 'Bootstrap / internal — not bay-facing',
  public: 'Unauthenticated or public token surface',
  unknown: 'Not classified — review before pilot',
};

function walkRouteFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkRouteFiles(full, acc);
    else if (name === 'route.ts') acc.push(full);
  }
  return acc;
}

function extractStringProp(src, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  const values = new Set();
  let m;
  while ((m = re.exec(src)) !== null) values.add(m[1]);
  return [...values];
}

function extractBoolProp(src, prop) {
  return new RegExp(`${prop}\\s*:\\s*true`).test(src);
}

function detectWrapper(src) {
  if (src.includes('withStoryAiRoute(')) return 'withStoryAiRoute';
  if (src.includes('withAuth(')) return 'withAuth';
  if (src.includes('withPublicRoute(')) return 'withPublicRoute';
  return 'bare-or-other';
}

function detectMethods(src) {
  const methods = [];
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    if (
      new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(src) ||
      new RegExp(`export\\s+function\\s+${m}\\b`).test(src)
    ) {
      methods.push(m);
    }
  }
  return methods;
}

function routeFileToApiPath(rel) {
  return '/' + rel.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');
}

/** Minimal override parser — mirrors resolvePilotStatus intent without TS import. */
function loadOverrides() {
  const src = readFileSync(OVERRIDES_PATH, 'utf8');
  const overrides = [];
  const blockRe =
    /\{\s*match:\s*(?:'([^']+)'|"([^"]+)"|\/((?:\\\/|[^/])+)\/([a-z]*))\s*,\s*pilotStatus:\s*'([^']+)'(?:\s*,\s*note:\s*'((?:\\'|[^'])*)')?/g;
  let m;
  while ((m = blockRe.exec(src)) !== null) {
    const str = m[1] || m[2] || null;
    const reBody = m[3] || null;
    const reFlags = m[4] || '';
    const pilotStatus = m[5];
    const note = m[6] ? m[6].replace(/\\'/g, "'") : undefined;
    overrides.push({
      kind: str ? 'string' : 'regex',
      value: str || reBody,
      flags: reFlags,
      pilotStatus,
      note,
    });
  }
  return overrides;
}

function resolvePilot(routeFile, moduleId, overrides) {
  if (moduleId === 'cdk_sync') {
    return { pilotStatus: 'deferred', note: 'Live CDK API deferred' };
  }
  for (const o of overrides) {
    if (o.kind === 'string') {
      if (routeFile.includes(o.value)) return { pilotStatus: o.pilotStatus, note: o.note };
    } else {
      try {
        const re = new RegExp(o.value, o.flags || undefined);
        if (re.test(routeFile)) return { pilotStatus: o.pilotStatus, note: o.note };
      } catch {
        // ignore bad regex
      }
    }
  }
  if (moduleId) {
    return { pilotStatus: 'pilot-optional', note: `Gated by module ${moduleId}` };
  }
  return { pilotStatus: 'unknown' };
}

function collectRoles(src) {
  const roles = [];
  if (extractBoolProp(src, 'requireOwnerNational') || extractBoolProp(src, 'requireOwner')) {
    roles.push('owner');
  }
  if (extractBoolProp(src, 'requireAdmin')) roles.push('admin');
  if (extractBoolProp(src, 'requireManager')) roles.push('manager');
  if (src.includes('withAuth(') || src.includes('withStoryAiRoute(')) {
    if (!roles.includes('owner') && !roles.includes('admin') && !roles.includes('manager')) {
      roles.push('authenticated');
    }
  }
  if (src.includes('withPublicRoute(') || detectWrapper(src) === 'bare-or-other') {
    if (roles.length === 0) roles.push('public-or-special');
  }
  return roles;
}

function buildMatrix() {
  const overrides = loadOverrides();
  const files = walkRouteFiles(API_ROOT).sort();
  const rows = [];

  for (const full of files) {
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    const src = readFileSync(full, 'utf8');
    const modules = extractStringProp(src, 'requireModule');
    const moduleId = modules[0] || null;
    const wrapper = detectWrapper(src);
    const methods = detectMethods(src);
    const rateKeys = extractStringProp(src, 'rateLimitKey');
    const pilot = resolvePilot(rel, moduleId, overrides);
    const roles = collectRoles(src);

    rows.push({
      routeFile: rel,
      apiPath: routeFileToApiPath(rel),
      methods,
      wrapper,
      moduleId,
      modules,
      roles,
      rateLimitKeys: rateKeys,
      requireDealershipContext:
        extractBoolProp(src, 'requireDealershipContext') ||
        (wrapper === 'withAuth' &&
          !extractBoolProp(src, 'requireOwner') &&
          !extractBoolProp(src, 'requireOwnerNational')),
      pilotStatus: pilot.pilotStatus,
      note: pilot.note || null,
    });
  }

  const byStatus = {};
  for (const r of rows) {
    byStatus[r.pilotStatus] = (byStatus[r.pilotStatus] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    routeCount: rows.length,
    byStatus,
    legend: PILOT_STATUS_LEGEND,
    rows,
  };
}

function toMarkdown(matrix) {
  const lines = [];
  lines.push('# Merlinus Capability Matrix (generated)');
  lines.push('');
  lines.push(`**Generated:** ${matrix.generatedAt}  `);
  lines.push(`**Routes:** ${matrix.routeCount}  `);
  lines.push('');
  lines.push('> Living matrix: re-run `npm run matrix:generate` after adding API routes.');
  lines.push('> Pilot status overrides: `src/lib/capabilityMatrix/overrides.ts`.');
  lines.push('');
  lines.push('## Legend');
  lines.push('');
  lines.push('| Status | Meaning |');
  lines.push('|--------|---------|');
  for (const [k, v] of Object.entries(matrix.legend)) {
    lines.push(`| \`${k}\` | ${v} |`);
  }
  lines.push('');
  lines.push('## Counts by pilot status');
  lines.push('');
  lines.push('| Status | Routes |');
  lines.push('|--------|--------|');
  for (const [k, n] of Object.entries(matrix.byStatus).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${n} |`);
  }
  lines.push('');
  lines.push('## Pilot-core surfaces (first MB store)');
  lines.push('');
  lines.push('| API path | Methods | Module | Roles | Note |');
  lines.push('|----------|---------|--------|-------|------|');
  for (const r of matrix.rows.filter((x) => x.pilotStatus === 'pilot-core')) {
    lines.push(
      `| \`${r.apiPath}\` | ${r.methods.join(' ') || '—'} | ${r.moduleId || 'core/always'} | ${r.roles.join(', ')} | ${r.note || ''} |`
    );
  }
  lines.push('');
  lines.push('## Deferred');
  lines.push('');
  const deferred = matrix.rows.filter((x) => x.pilotStatus === 'deferred');
  if (deferred.length === 0) {
    lines.push('_No deferred routes matched (cdk may be catalog-only)._');
  } else {
    lines.push('| API path | Note |');
    lines.push('|----------|------|');
    for (const r of deferred) {
      lines.push(`| \`${r.apiPath}\` | ${r.note || ''} |`);
    }
  }
  lines.push('');
  lines.push('## Full matrix');
  lines.push('');
  lines.push('| API path | Methods | Wrapper | Module | Roles | Pilot | Note |');
  lines.push('|----------|---------|---------|--------|-------|-------|------|');
  for (const r of matrix.rows) {
    lines.push(
      `| \`${r.apiPath}\` | ${r.methods.join(' ') || '—'} | ${r.wrapper} | ${r.moduleId || '—'} | ${r.roles.join(', ')} | \`${r.pilotStatus}\` | ${(r.note || '').replace(/\|/g, '/')} |`
    );
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Do not hand-edit this file. Update overrides or routes, then regenerate.*');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const matrix = buildMatrix();
  mkdirSync(OUT_DIR, { recursive: true });
  const json = `${JSON.stringify(matrix, null, 2)}\n`;
  const md = toMarkdown(matrix);

  if (CHECK) {
    if (!existsSync(JSON_OUT) || !existsSync(MD_OUT)) {
      console.error(`${PREFIX} FAIL: generated matrix missing — run npm run matrix:generate`);
      process.exit(1);
    }
    const prev = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
    const normalize = (m) =>
      JSON.stringify({
        routeCount: m.routeCount,
        byStatus: m.byStatus,
        rows: m.rows,
      });
    if (normalize(prev) !== normalize(matrix)) {
      console.error(`${PREFIX} FAIL: capability matrix is stale — run npm run matrix:generate`);
      process.exit(1);
    }
    console.log(`${PREFIX} OK: matrix up to date (${matrix.routeCount} routes)`);
    return;
  }

  writeFileSync(JSON_OUT, json);
  writeFileSync(MD_OUT, md);
  console.log(`${PREFIX} wrote ${relative(ROOT, JSON_OUT)} (${matrix.routeCount} routes)`);
  console.log(`${PREFIX} wrote ${relative(ROOT, MD_OUT)}`);
  console.log(`${PREFIX} by status: ${JSON.stringify(matrix.byStatus)}`);
}

main();
