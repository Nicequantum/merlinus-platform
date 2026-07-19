/**
 * APEX NATIONAL PLATFORM — load .env.apex.local when Apex is active.
 * MERLINUS SINGLE-DEALER: no-op when neither APEX_ENV nor PLATFORM_MODE=apex.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let apexEnvLoaded = false;

export function isApexEnvEnabled(): boolean {
  const value = process.env.APEX_ENV?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/** True when national Apex platform is selected (env flag or platform mode). */
export function isApexPlatformEnvActive(): boolean {
  if (isApexEnvEnabled()) return true;
  const mode = process.env.PLATFORM_MODE?.trim().toLowerCase();
  if (mode === 'apex') return true;
  const publicMode = process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim().toLowerCase();
  return publicMode === 'apex';
}

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

/**
 * Load .env.apex.local when Apex is active (APEX_ENV or PLATFORM_MODE=apex).
 * Existing process.env values win unless override=true.
 *
 * Never touch the filesystem on Cloudflare Workers / OpenNext (unenv has no
 * real fs — existsSync/readFileSync throw and break login).
 */
export function loadApexEnvFile(options: { override?: boolean } = {}): boolean {
  if (!isApexPlatformEnvActive()) return false;
  if (apexEnvLoaded && !options.override) return true;

  // Workers / OpenNext: secrets come from wrangler; skip .env.apex.local.
  if (typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== 'undefined') {
    apexEnvLoaded = true;
    return false;
  }
  if (
    process.env.CF_PAGES === '1' ||
    process.env.CF_PAGES === 'true' ||
    Boolean(process.env.OPEN_NEXT_ORIGIN?.trim())
  ) {
    apexEnvLoaded = true;
    return false;
  }

  const path = resolve(process.cwd(), '.env.apex.local');
  try {
    if (!existsSync(path)) return false;
  } catch {
    // unenv / missing fs
    return false;
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const line of content.split('\n')) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (options.override || !process.env[parsed.key]?.trim()) {
      process.env[parsed.key] = parsed.value;
    }
  }

  apexEnvLoaded = true;
  return true;
}

/** Reset loader state (unit tests). */
export function resetApexEnvLoadState(): void {
  apexEnvLoaded = false;
}
