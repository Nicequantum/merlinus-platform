import { dealerIdWriteFields, scopedDealershipWhere } from '@/lib/apex/dealerScope';
import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  getDefaultDealershipTimezone,
  getStartOfDealershipDay,
  resolveDealershipTimezone,
} from '@/lib/dealershipDayBoundary';

/** M28: configurable daily AI usage cap per technician. */
function parseDailyLimit(): number {
  const raw = Number(process.env.DAILY_USAGE_LIMIT ?? 50);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 50;
}

export const DAILY_USAGE_LIMIT = parseDailyLimit();

/**
 * M29: env key for dealership-day boundary timezone (fallback when rooftop TZ absent).
 * Resolved via getDefaultDealershipTimezone() / resolveDealershipTimezone().
 */
export const USAGE_TIMEZONE = process.env.USAGE_TIMEZONE?.trim() || undefined;

/** Phase 7.3 — prefer rooftop timezone from session, then USAGE_TIMEZONE env default. */
function getUsageTimezone(preferred?: string | null): string {
  return resolveDealershipTimezone(preferred, USAGE_TIMEZONE ?? getDefaultDealershipTimezone());
}

function startOfZonedDay(date = new Date(), timeZone?: string | null): Date {
  return getStartOfDealershipDay(date, getUsageTimezone(timeZone));
}

function startOfZonedWeek(date = new Date(), timeZone?: string | null): Date {
  const tz = getUsageTimezone(timeZone);
  const dayStart = startOfZonedDay(date, tz);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(dayStart);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const daysFromMonday = map[weekday] ?? 0;
  return new Date(dayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
}

export async function getTechnicianDailyUsageCount(
  technicianId: string,
  timeZone?: string | null
): Promise<number> {
  return getRlsDb().usageLog.count({
    where: {
      technicianId,
      createdAt: { gte: startOfZonedDay(new Date(), timeZone) },
    },
  });
}

export async function isDailyUsageLimitReached(
  technicianId: string,
  timeZone?: string | null
): Promise<boolean> {
  const count = await getTechnicianDailyUsageCount(technicianId, timeZone);
  return count >= DAILY_USAGE_LIMIT;
}

export async function logApiUsage(input: {
  technicianId: string;
  dealershipId: string;
  dealerId?: string | null;
  routeKey: string;
}): Promise<void> {
  await getRlsDb().usageLog.create({
    data: {
      technicianId: input.technicianId,
      dealershipId: input.dealershipId,
      routeKey: input.routeKey,
      ...dealerIdWriteFields(input.dealerId),
    },
  });
}

export interface TechnicianUsageSummary {
  technicianId: string;
  name: string;
  d7Number: string | null;
  role: string;
  dailyCount: number;
  weeklyCount: number;
}

export interface UsageAnalytics {
  dailyLimit: number;
  totalDailyUsage: number;
  technicians: TechnicianUsageSummary[];
}

export async function getUsageAnalytics(
  dealershipId: string,
  dealerId?: string | null
): Promise<UsageAnalytics> {
  const dayStart = startOfZonedDay();
  const weekStart = startOfZonedWeek();
  const usageWhere = scopedDealershipWhere(dealershipId, dealerId);

  const [technicians, dailyLogs, weeklyLogs] = await Promise.all([
    getRlsDb().technician.findMany({
      where: { dealershipId, isActive: true, deletedAt: null },
      select: { id: true, name: true, d7Number: true, role: true },
      orderBy: { name: 'asc' },
    }),
    getRlsDb().usageLog.groupBy({
      by: ['technicianId'],
      where: { ...usageWhere, createdAt: { gte: dayStart } },
      _count: { _all: true },
    }),
    getRlsDb().usageLog.groupBy({
      by: ['technicianId'],
      where: { ...usageWhere, createdAt: { gte: weekStart } },
      _count: { _all: true },
    }),
  ]);

  const dailyByTech = new Map(dailyLogs.map((row) => [row.technicianId, row._count._all]));
  const weeklyByTech = new Map(weeklyLogs.map((row) => [row.technicianId, row._count._all]));

  const summaries: TechnicianUsageSummary[] = technicians
    .map((tech) => ({
      technicianId: tech.id,
      name: tech.name,
      d7Number: tech.d7Number,
      role: tech.role,
      dailyCount: dailyByTech.get(tech.id) ?? 0,
      weeklyCount: weeklyByTech.get(tech.id) ?? 0,
    }))
    .sort((a, b) => b.dailyCount - a.dailyCount || b.weeklyCount - a.weeklyCount || a.name.localeCompare(b.name));

  return {
    dailyLimit: DAILY_USAGE_LIMIT,
    totalDailyUsage: summaries.reduce((sum, row) => sum + row.dailyCount, 0),
    technicians: summaries,
  };
}

export function getUsageTimezoneForHealth(): string {
  return getUsageTimezone();
}