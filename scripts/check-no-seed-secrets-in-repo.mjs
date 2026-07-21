#!/usr/bin/env node
/**
 * P0 — Fail if tracked files contain real owner-seed password material
 * or if forbidden local seed env files are staged/tracked.
 *
 * Usage: node scripts/check-no-seed-secrets-in-repo.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const PREFIX = '[merlin:seed-secrets]';

const FORBIDDEN_TRACKED_BASENAMES = [
  '.owner-seed.local.env',
  '.owner-seed.env',
];

/** Assignment lines that look like real secrets (not placeholders / docs). */
const SECRET_ASSIGNMENT =
  /^\s*(?:export\s+)?(OWNER_SEED_PASSWORD(?:_2)?|MULTI_ROOFTOP_SEED_PASSWORD)\s*=\s*(.+)$/i;

const PLACEHOLDER =
  /^(?:your[-_]|changeme|placeholder|example|xxx|<.*>|""|'')|example\.com|strong-.*password|seed-password/i;

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.next',
  '.open-next',
  '.wrangler',
  'dist',
  'coverage',
  'agent-tools',
  'terminals',
  'mcps',
]);

function listTrackedFiles() {
  try {
    const out = execSync('git ls-files -z', { cwd: ROOT, encoding: 'buffer' });
    return out
      .toString('utf8')
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function walkFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isTextPath(filePath) {
  return /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|toml|env|example|txt|sh|ps1|sql)$/i.test(
    filePath
  );
}

function scanContent(filePath, content, failures) {
  const rel = relative(ROOT, filePath).replace(/\\/g, '/');
  // Examples and docs may show OWNER_SEED_PASSWORD="your-strong-..." — allowed.
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('#')) continue;
    const m = line.match(SECRET_ASSIGNMENT);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (PLACEHOLDER.test(value) || value.length < 8) continue;
    // Commented example in markdown code fences often uses placeholder wording.
    if (rel.endsWith('.example') || rel.includes('.example.')) continue;
    if (/\.md$/i.test(rel) && /your-strong|example\.com|changeme/i.test(value)) continue;
    failures.push(
      `${rel}:${i + 1} — ${m[1]} appears to contain a real secret value (not a placeholder)`
    );
  }
}

function main() {
  const failures = [];

  const tracked = listTrackedFiles();
  if (tracked) {
    for (const rel of tracked) {
      const base = rel.split('/').pop() || rel;
      if (
        FORBIDDEN_TRACKED_BASENAMES.includes(base) ||
        /^\.owner-seed/i.test(base) ||
        /seed.*\.local\.env$/i.test(base)
      ) {
        failures.push(`Tracked forbidden seed env file: ${rel}`);
      }
      const full = resolve(ROOT, rel);
      if (!existsSync(full) || !isTextPath(rel)) continue;
      try {
        const content = readFileSync(full, 'utf8');
        scanContent(full, content, failures);
      } catch {
        // skip binary/unreadable
      }
    }
  } else {
    // Fallback without git
    for (const full of walkFiles(ROOT)) {
      if (!isTextPath(full)) continue;
      try {
        scanContent(full, readFileSync(full, 'utf8'), failures);
      } catch {
        // skip
      }
    }
  }

  // Local file present is OK if gitignored — remind operator only.
  if (existsSync(resolve(ROOT, '.owner-seed.local.env'))) {
    console.warn(
      `${PREFIX} WARN: .owner-seed.local.env exists locally. ` +
        'Use it only for one-time bootstrap (scripts/seed-owner-d1-remote.mjs), ' +
        'then delete the file and remove secrets from the Worker. Never commit it.'
    );
  }

  if (failures.length > 0) {
    console.error(`${PREFIX} FAIL: ${failures.length} issue(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(`${PREFIX} OK: no tracked owner-seed password secrets`);
}

main();
