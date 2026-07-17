/**
 * Dealership-local calendar day boundaries for RO list scoping and usage caps.
 * Phase 7.3 (H7) — prefer per-rooftop IANA timezone, then USAGE_TIMEZONE env, then America/New_York.
 */

export const DEFAULT_DEALERSHIP_TIMEZONE = 'America/New_York';

/** Process-wide fallback (Merlinus single-store env). */
export function getDefaultDealershipTimezone(): string {
  return process.env.USAGE_TIMEZONE?.trim() || DEFAULT_DEALERSHIP_TIMEZONE;
}

/**
 * Resolve effective IANA timezone for a request:
 * session.dealershipTimezone → explicit override → env → default.
 */
export function resolveDealershipTimezone(
  preferred?: string | null,
  fallback?: string | null
): string {
  const candidate = preferred?.trim() || fallback?.trim() || getDefaultDealershipTimezone();
  return isValidIanaTimezone(candidate) ? candidate : DEFAULT_DEALERSHIP_TIMEZONE;
}

/** Lightweight validation — rejects empty/garbage; accepts common IANA forms. */
export function isValidIanaTimezone(value: string): boolean {
  const tz = value.trim();
  if (!tz || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** @deprecated Prefer resolveDealershipTimezone / getDefaultDealershipTimezone */
export function getDealershipTimezone(): string {
  return getDefaultDealershipTimezone();
}

function zonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/** UTC instant for midnight at the start of the dealership-local day. */
export function getStartOfDealershipDay(
  date = new Date(),
  timeZone = getDefaultDealershipTimezone()
): Date {
  const tz = resolveDealershipTimezone(timeZone);
  const { year, month, day } = zonedParts(date, tz);
  for (let offsetHours = -14; offsetHours <= 14; offsetHours++) {
    const candidate = new Date(Date.UTC(year, month - 1, day, -offsetHours, 0, 0, 0));
    const parts = zonedParts(candidate, tz);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === 0) {
      return candidate;
    }
  }
  const fallback = new Date(date);
  fallback.setHours(0, 0, 0, 0);
  return fallback;
}

/** True when the RO was touched on or after dealership-local midnight today. */
export function isRepairOrderActiveToday(
  updatedAt: string | undefined,
  todayStartIso: string,
  createdAt?: string
): boolean {
  const stamp = updatedAt || createdAt;
  if (!stamp) return true;
  return new Date(stamp) >= new Date(todayStartIso);
}
