/**
 * Self-heal + nightly ops maintenance configuration (env-driven).
 * Safe defaults: analysis on, auto code mutation never.
 */

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const n = value.trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes';
}

function parseHour(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw?.trim() || '', 10);
  if (!Number.isFinite(n) || n < 0 || n > 23) return fallback;
  return n;
}

/** GROK_SELF_HEAL_ENABLED=true — Grok analyzes health signals; never auto-edits source. */
export function isGrokSelfHealEnabled(): boolean {
  return isTruthy(process.env.GROK_SELF_HEAL_ENABLED);
}

/**
 * Local wall-clock timezone for the nightly window (IANA).
 * Default America/New_York (MB pilot East/Central ops).
 */
export function getMaintenanceTimezone(): string {
  return process.env.MERLIN_MAINTENANCE_TZ?.trim() || 'America/New_York';
}

/** Inclusive start hour local (default 20 = 8pm). */
export function getNightlyWindowStartHour(): number {
  return parseHour(process.env.MERLIN_NIGHTLY_WINDOW_START, 20);
}

/** Exclusive end hour local (default 6 = 6am). Window can wrap midnight. */
export function getNightlyWindowEndHour(): number {
  return parseHour(process.env.MERLIN_NIGHTLY_WINDOW_END, 6);
}

/**
 * When true during nightly window, set soft AI throttle guidance only.
 * Full MERLIN_MAINTENANCE_MODE still blocks AI and stays operator-controlled.
 */
export function isNightlySoftMaintenanceEnabled(): boolean {
  // Default on when self-heal enabled
  if (process.env.MERLIN_NIGHTLY_SOFT_MAINTENANCE === undefined) {
    return isGrokSelfHealEnabled();
  }
  return isTruthy(process.env.MERLIN_NIGHTLY_SOFT_MAINTENANCE);
}

/** Bearer secret for /api/ops/* cron endpoints. */
export function getOpsMaintenanceSecret(): string | null {
  const a = process.env.OPS_MAINTENANCE_SECRET?.trim();
  if (a) return a;
  // Reuse queue consumer secret when dedicated secret unset (one less secret to manage).
  const b = process.env.AI_QUEUE_CONSUMER_SECRET?.trim();
  return b || null;
}

export function isOpsCronAuthorized(request: Request): boolean {
  const expected = getOpsMaintenanceSecret();
  if (!expected) {
    // Dev only: allow when not production
    if (process.env.NODE_ENV !== 'production') return true;
    return false;
  }
  const auth = request.headers.get('authorization')?.trim() || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() === expected;
  }
  return request.headers.get('x-ops-maintenance-secret')?.trim() === expected;
}

export const SELF_HEAL_KV_PREFIX = 'merlin:selfheal:';
export const NIGHTLY_REPORT_KEY = `${SELF_HEAL_KV_PREFIX}nightly:latest`;
export const MORNING_WARMUP_KEY = `${SELF_HEAL_KV_PREFIX}morning:latest`;
export const WINDOW_STATE_KEY = `${SELF_HEAL_KV_PREFIX}window:state`;
