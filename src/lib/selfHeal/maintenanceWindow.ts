/**
 * Nightly maintenance window math (timezone-aware, wrap-friendly).
 * Default: 20:00–06:00 America/New_York — shrink via env as home usage grows.
 */

import {
  getMaintenanceTimezone,
  getNightlyWindowEndHour,
  getNightlyWindowStartHour,
} from '@/lib/selfHeal/config';

export interface MaintenanceWindowSnapshot {
  timezone: string;
  localHour: number;
  localDate: string;
  startHour: number;
  endHour: number;
  /** True when wall clock is inside [start, end) with midnight wrap support. */
  inWindow: boolean;
  phase: 'day' | 'nightly' | 'morning_edge';
}

function localParts(now: Date, timeZone: string): { hour: number; date: string } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || '0';
    let hour = Number.parseInt(get('hour'), 10);
    // Some engines use 24 for midnight
    if (hour === 24) hour = 0;
    const date = `${get('year')}-${get('month')}-${get('day')}`;
    return { hour: Number.isFinite(hour) ? hour : now.getUTCHours(), date };
  } catch {
    return {
      hour: now.getUTCHours(),
      date: now.toISOString().slice(0, 10),
    };
  }
}

/**
 * Window can wrap midnight: e.g. start=20 end=6 → in when hour>=20 || hour<6.
 * Non-wrapping: start=22 end=23 → hour>=22 && hour<23.
 */
export function isHourInWindow(hour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return false; // zero-width = disabled
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  return hour >= startHour || hour < endHour;
}

export function getMaintenanceWindowSnapshot(now = new Date()): MaintenanceWindowSnapshot {
  const timezone = getMaintenanceTimezone();
  const startHour = getNightlyWindowStartHour();
  const endHour = getNightlyWindowEndHour();
  const { hour: localHour, date: localDate } = localParts(now, timezone);
  const inWindow = isHourInWindow(localHour, startHour, endHour);

  let phase: MaintenanceWindowSnapshot['phase'] = 'day';
  if (inWindow) {
    // Last hour of window = morning edge (warmup-heavy)
    const prevHour = (endHour + 23) % 24;
    phase = localHour === prevHour || localHour < endHour ? 'morning_edge' : 'nightly';
    if (localHour >= startHour) phase = 'nightly';
    if (endHour > 0 && localHour < endHour) phase = 'morning_edge';
  }

  return {
    timezone,
    localHour,
    localDate,
    startHour,
    endHour,
    inWindow,
    phase,
  };
}
