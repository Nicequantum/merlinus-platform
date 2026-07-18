import 'server-only';

import { Prisma } from '@prisma/client';
import { listDealerIdsForOwnerGroups } from '@/lib/apex/dealerGroupAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';

export interface OwnerNationalActivityItem {
  id: string;
  action: string;
  dealershipName: string | null;
  dealerCode: string | null;
  createdAt: string;
}

/** Per-rooftop scoreboard (PII-free). */
export interface OwnerRooftopScorecard {
  dealershipId: string;
  name: string;
  dealerCode: string | null;
  dealerName: string | null;
  activeStaff: number;
  /** Staff depth by role */
  managers: number;
  technicians: number;
  advisors: number;
  roVolume7d: number;
  roVolume30d: number;
  /** Prior calendar 7d window for trend */
  roVolumePrior7d: number;
  roVolumeTrendPct: number | null;
  certifiedStories7d: number;
  certifiedStories30d: number;
  certificationRatePct: number | null;
  aiUsage7d: number;
  logins7d: number;
  staffMustChangePassword: number;
  /** Distinct staff with login/activity in last 7d / active staff (0–100). */
  adoptionRatePct: number;
  /** healthy | watch | attention */
  status: 'healthy' | 'watch' | 'attention';
  attentionReasons: string[];
  lastActivityAt: string | null;
  /** Daily RO volume last 14 days (oldest → newest) for sparkline */
  roDaily14d: number[];
}

export interface OwnerAttentionFlag {
  code: string;
  label: string;
  severity: 'watch' | 'attention';
  /** PR-G5 — ops | risk | compliance | quality */
  category?: 'ops' | 'risk' | 'compliance' | 'quality';
  dealershipId?: string;
  dealershipName?: string;
}

export interface OwnerTrendSeries {
  /** ISO date (UTC day) oldest → newest */
  dates: string[];
  /** Values aligned with dates */
  values: number[];
  current7d: number;
  prior7d: number;
  /** Percent change current vs prior; null if prior is 0 */
  changePct: number | null;
}

export interface OwnerNationalSummary {
  dealerCount: number;
  dealershipCount: number;
  activeUsers: number;
  /** @deprecated prefer repairOrders7d */
  repairOrdersLast7Days: number;
  repairOrders7d: number;
  repairOrders30d: number;
  certifiedStories7d: number;
  certifiedStories30d: number;
  adoptionRatePct: number;
  attentionFlagCount: number;
  attentionFlags: OwnerAttentionFlag[];
  rooftops: OwnerRooftopScorecard[];
  recentActivity: OwnerNationalActivityItem[];
  generatedAt: string;
  scopeMode?: 'national' | 'group';
  dealerGroupId?: string | null;
  dealerGroupName?: string | null;

  // ─── PR-G4 Tier 2 ─────────────────────────────────────────────
  /** RO volume trend with 14-day sparkline series */
  volumeTrend: OwnerTrendSeries;
  /** Certified stories / ROs updated in 7d (proxy completion rate) */
  certificationRatePct: number | null;
  /** Median hours from RO create → first certification (30d sample) */
  medianTimeToCertifyHours: number | null;
  /** UsageLog AI route hits in 7d */
  aiUsage7d: number;
  /** Distinct auth.login events / staff in 7d */
  logins7d: number;
  staffMustChangePassword: number;
  /** Certification count trend sparkline */
  certificationTrend: OwnerTrendSeries;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export interface OwnerSummaryContext {
  technicianId: string;
  scopeMode?: 'national' | 'group' | 'dealership';
  activeDealerGroupId?: string | null;
  dealerGroupName?: string | null;
}

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function dayKey(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
}

function buildDayKeys(end: Date, days: number): string[] {
  const keys: string[] = [];
  const endDay = utcDayStart(end);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDay.getTime() - i * 24 * 60 * 60 * 1000);
    keys.push(dayKey(d));
  }
  return keys;
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
  }
  return Math.round(sorted[mid]! * 10) / 10;
}

function seriesFromDaily(
  dayKeys: string[],
  countsByDay: Map<string, number>
): OwnerTrendSeries {
  const values = dayKeys.map((k) => countsByDay.get(k) ?? 0);
  const prior7d = values.slice(0, 7).reduce((a, b) => a + b, 0);
  const current7d = values.slice(7).reduce((a, b) => a + b, 0);
  return {
    dates: dayKeys,
    values,
    current7d,
    prior7d,
    changePct: percentChange(current7d, prior7d),
  };
}

/**
 * Owner home aggregates — no customer PII.
 * Tier 1 + Tier 2 (PR-G3 / PR-G4).
 */
export async function getOwnerNationalSummary(
  context?: OwnerSummaryContext
): Promise<OwnerNationalSummary> {
  // Phase 6.2 — national aggregates need control-plane bypass under default-deny RLS.
  return withRlsBypass(async () => computeOwnerNationalSummary(context));
}

/**
 * Phase 7.1 H5 — align summary scope with platform operator / group membership.
 * Platform operator → national (null dealer filter). Group → dealer ids. Else empty.
 * Prefer session scopeMode when provided and consistent with rights.
 */
async function resolveOwnerSummaryDealerScope(
  context?: OwnerSummaryContext
): Promise<{ isGroupScoped: boolean; dealerIdList: string[] | null; scopeMode: 'national' | 'group' }> {
  if (!context?.technicianId) {
    return { isGroupScoped: false, dealerIdList: null, scopeMode: 'national' };
  }

  const scopedDealerIds = await listDealerIdsForOwnerGroups(context.technicianId);
  // null = platform operator (national); array = group-scoped (possibly empty)
  const isNationalOperator = scopedDealerIds === null;

  if (isNationalOperator) {
    // Platform operators always see national portfolio (enter/list unrestricted).
    return { isGroupScoped: false, dealerIdList: null, scopeMode: 'national' };
  }

  const dealerIdList =
    scopedDealerIds.length > 0 ? scopedDealerIds : (['__none__'] as string[]);
  return { isGroupScoped: true, dealerIdList, scopeMode: 'group' };
}

/** Phase 7.1 H3 — daily buckets via SQL (no full-row materialization). */
async function loadDailyActivityBuckets(
  rooftopIds: string[],
  since: Date
): Promise<{
  roRows: Array<{ dealershipId: string; day: string; count: number }>;
  certRows: Array<{ dealershipId: string; day: string; count: number }>;
}> {
  if (rooftopIds.length === 0 || rooftopIds[0] === '__none__') {
    return { roRows: [], certRows: [] };
  }

  const db = getRlsDb();
  const idList = Prisma.join(rooftopIds.map((id) => Prisma.sql`${id}`));

  // SQLite/D1: date(col) returns UTC day string; avoid Postgres date_trunc / AT TIME ZONE.
  const [roBuckets, certBuckets] = await Promise.all([
    db.$queryRaw<Array<{ dealershipId: string; day: string; count: number }>>`
      SELECT "dealershipId",
             date("updatedAt") AS day,
             COUNT(*) AS count
      FROM "RepairOrder"
      WHERE "dealershipId" IN (${idList})
        AND "updatedAt" >= ${since}
      GROUP BY 1, 2
    `,
    db.$queryRaw<Array<{ dealershipId: string; day: string; count: number }>>`
      SELECT "dealershipId",
             date("certifiedAt") AS day,
             COUNT(*) AS count
      FROM "TechnicianCertifiedStory"
      WHERE "dealershipId" IN (${idList})
        AND "certifiedAt" >= ${since}
      GROUP BY 1, 2
    `,
  ]);

  const toRows = (rows: Array<{ dealershipId: string; day: string | Date; count: number }>) =>
    rows.map((r) => ({
      dealershipId: r.dealershipId,
      day: dayKey(r.day instanceof Date ? r.day : new Date(String(r.day))),
      count: Number(r.count) || 0,
    }));

  return { roRows: toRows(roBuckets), certRows: toRows(certBuckets) };
}

async function computeOwnerNationalSummary(
  context?: OwnerSummaryContext
): Promise<OwnerNationalSummary> {
  const now = Date.now();
  const nowDate = new Date(now);
  const weekAgo = new Date(now - SEVEN_DAYS_MS);
  const twoWeeksAgo = new Date(now - FOURTEEN_DAYS_MS);
  const monthAgo = new Date(now - THIRTY_DAYS_MS);

  const {
    isGroupScoped,
    dealerIdList,
    scopeMode: resolvedScopeMode,
  } = await resolveOwnerSummaryDealerScope(context);

  const rooftops = await loadRooftopRows(dealerIdList);
  const rooftopIds = rooftops.map((r) => r.id);
  const effectiveRooftopIds = rooftopIds.length > 0 ? rooftopIds : ['__none__'];
  const dayKeys14 = buildDayKeys(nowDate, 14);

  const [
    dealerCount,
    activeUsers,
    ro7,
    ro30,
    roPrior7,
    cert7,
    cert30,
    activeStaffWithActivity7d,
    activityRows,
    mustChangePasswordCount,
    lastActivityByRooftop,
    staffByRooftop,
    staffByRooftopRole,
    ro7ByRooftop,
    ro30ByRooftop,
    roPrior7ByRooftop,
    cert7ByRooftop,
    cert30ByRooftop,
    activeStaffByRooftop7d,
    dailyBuckets,
    aiUsage7d,
    aiByRooftop,
    logins7d,
    loginsByRooftop,
    mustChangeByRooftop,
    certSample,
  ] = await Promise.all([
    getRlsDb().dealer.count({
      where: isGroupScoped
        ? { status: 'active', id: { in: dealerIdList! } }
        : { status: 'active' },
    }),
    getRlsDb().technician.count({
      where: {
        isActive: true,
        deletedAt: null,
        role: { not: 'owner' },
        dealershipId: { in: effectiveRooftopIds },
      },
    }),
    getRlsDb().repairOrder.count({
      where: { dealershipId: { in: effectiveRooftopIds }, updatedAt: { gte: weekAgo } },
    }),
    getRlsDb().repairOrder.count({
      where: { dealershipId: { in: effectiveRooftopIds }, updatedAt: { gte: monthAgo } },
    }),
    getRlsDb().repairOrder.count({
      where: {
        dealershipId: { in: effectiveRooftopIds },
        updatedAt: { gte: twoWeeksAgo, lt: weekAgo },
      },
    }),
    getRlsDb().technicianCertifiedStory.count({
      where: { dealershipId: { in: effectiveRooftopIds }, certifiedAt: { gte: weekAgo } },
    }),
    getRlsDb().technicianCertifiedStory.count({
      where: { dealershipId: { in: effectiveRooftopIds }, certifiedAt: { gte: monthAgo } },
    }),
    getRlsDb().auditLog.findMany({
      where: {
        dealershipId: { in: effectiveRooftopIds },
        createdAt: { gte: weekAgo },
        technicianId: { not: null },
        action: { in: ['auth.login', 'auth.refresh', 'ro.create', 'story.certify', 'story.generate'] },
      },
      select: { technicianId: true },
      distinct: ['technicianId'],
    }),
    getRlsDb().auditLog.findMany({
      where: { dealershipId: { in: effectiveRooftopIds } },
      select: {
        id: true,
        action: true,
        createdAt: true,
        dealership: {
          select: { name: true, dealer: { select: { code: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    getRlsDb().technician.count({
      where: {
        isActive: true,
        deletedAt: null,
        mustChangePassword: true,
        role: { not: 'owner' },
        dealershipId: { in: effectiveRooftopIds },
      },
    }),
    getRlsDb().auditLog.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds } },
      _max: { createdAt: true },
    }),
    getRlsDb().technician.groupBy({
      by: ['dealershipId'],
      where: {
        isActive: true,
        deletedAt: null,
        role: { not: 'owner' },
        dealershipId: { in: effectiveRooftopIds },
      },
      _count: { _all: true },
    }),
    getRlsDb().technician.groupBy({
      by: ['dealershipId', 'role'],
      where: {
        isActive: true,
        deletedAt: null,
        role: { not: 'owner' },
        dealershipId: { in: effectiveRooftopIds },
      },
      _count: { _all: true },
    }),
    getRlsDb().repairOrder.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds }, updatedAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    getRlsDb().repairOrder.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds }, updatedAt: { gte: monthAgo } },
      _count: { _all: true },
    }),
    getRlsDb().repairOrder.groupBy({
      by: ['dealershipId'],
      where: {
        dealershipId: { in: effectiveRooftopIds },
        updatedAt: { gte: twoWeeksAgo, lt: weekAgo },
      },
      _count: { _all: true },
    }),
    getRlsDb().technicianCertifiedStory.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds }, certifiedAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    getRlsDb().technicianCertifiedStory.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds }, certifiedAt: { gte: monthAgo } },
      _count: { _all: true },
    }),
    getRlsDb().auditLog.groupBy({
      by: ['dealershipId', 'technicianId'],
      where: {
        dealershipId: { in: effectiveRooftopIds },
        createdAt: { gte: weekAgo },
        technicianId: { not: null },
        action: { in: ['auth.login', 'auth.refresh', 'ro.create', 'story.certify', 'story.generate'] },
      },
    }),
    loadDailyActivityBuckets(effectiveRooftopIds, twoWeeksAgo),
    getRlsDb().usageLog.count({
      where: { dealershipId: { in: effectiveRooftopIds }, createdAt: { gte: weekAgo } },
    }),
    getRlsDb().usageLog.groupBy({
      by: ['dealershipId'],
      where: { dealershipId: { in: effectiveRooftopIds }, createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    getRlsDb().auditLog.count({
      where: {
        dealershipId: { in: effectiveRooftopIds },
        createdAt: { gte: weekAgo },
        action: 'auth.login',
      },
    }),
    getRlsDb().auditLog.groupBy({
      by: ['dealershipId'],
      where: {
        dealershipId: { in: effectiveRooftopIds },
        createdAt: { gte: weekAgo },
        action: 'auth.login',
      },
      _count: { _all: true },
    }),
    getRlsDb().technician.groupBy({
      by: ['dealershipId'],
      where: {
        isActive: true,
        deletedAt: null,
        mustChangePassword: true,
        role: { not: 'owner' },
        dealershipId: { in: effectiveRooftopIds },
      },
      _count: { _all: true },
    }),
    getRlsDb().technicianCertifiedStory.findMany({
      where: {
        dealershipId: { in: effectiveRooftopIds },
        certifiedAt: { gte: monthAgo },
      },
      select: {
        certifiedAt: true,
        repairOrderId: true,
      },
      take: 500,
      orderBy: { certifiedAt: 'desc' },
    }),
  ]);

  // Time-to-certify: load RO createdAt for sample
  const roIds = [...new Set(certSample.map((c) => c.repairOrderId))];
  const roCreated =
    roIds.length > 0
      ? await getRlsDb().repairOrder.findMany({
          where: { id: { in: roIds } },
          select: { id: true, createdAt: true },
        })
      : [];
  const roCreatedMap = new Map(roCreated.map((r) => [r.id, r.createdAt]));
  const hoursToCert: number[] = [];
  for (const c of certSample) {
    const created = roCreatedMap.get(c.repairOrderId);
    if (!created) continue;
    const hrs = (c.certifiedAt.getTime() - created.getTime()) / (60 * 60 * 1000);
    if (hrs >= 0 && hrs < 24 * 60) hoursToCert.push(hrs);
  }
  const medianTimeToCertifyHours = median(hoursToCert);

  // Portfolio daily series (Phase 7.1 H3 — SQL day buckets, not full row lists)
  const roDayCounts = new Map<string, number>();
  const certDayCounts = new Map<string, number>();
  const roDayByRooftop = new Map<string, Map<string, number>>();
  for (const row of dailyBuckets.roRows) {
    roDayCounts.set(row.day, (roDayCounts.get(row.day) ?? 0) + row.count);
    const m = roDayByRooftop.get(row.dealershipId) ?? new Map();
    m.set(row.day, (m.get(row.day) ?? 0) + row.count);
    roDayByRooftop.set(row.dealershipId, m);
  }
  for (const row of dailyBuckets.certRows) {
    certDayCounts.set(row.day, (certDayCounts.get(row.day) ?? 0) + row.count);
  }
  const volumeTrend = seriesFromDaily(dayKeys14, roDayCounts);
  const certificationTrend = seriesFromDaily(dayKeys14, certDayCounts);

  const lastActivityMap = new Map(
    lastActivityByRooftop.map((r) => [r.dealershipId, r._max.createdAt])
  );
  const staffMap = new Map(staffByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const roleDepth = new Map<string, { managers: number; technicians: number; advisors: number }>();
  for (const row of staffByRooftopRole) {
    const cur = roleDepth.get(row.dealershipId) ?? {
      managers: 0,
      technicians: 0,
      advisors: 0,
    };
    if (row.role === 'manager') cur.managers = row._count._all;
    else if (row.role === 'service_advisor') cur.advisors = row._count._all;
    else cur.technicians += row._count._all;
    roleDepth.set(row.dealershipId, cur);
  }
  const ro7Map = new Map(ro7ByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const ro30Map = new Map(ro30ByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const roPrior7Map = new Map(roPrior7ByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const cert7Map = new Map(cert7ByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const cert30Map = new Map(cert30ByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const aiMap = new Map(aiByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const loginMap = new Map(loginsByRooftop.map((r) => [r.dealershipId, r._count._all]));
  const mustChangeMap = new Map(mustChangeByRooftop.map((r) => [r.dealershipId, r._count._all]));

  const activeStaffIdsByRooftop = new Map<string, Set<string>>();
  for (const row of activeStaffByRooftop7d) {
    if (!row.technicianId) continue;
    const set = activeStaffIdsByRooftop.get(row.dealershipId) ?? new Set();
    set.add(row.technicianId);
    activeStaffIdsByRooftop.set(row.dealershipId, set);
  }

  const attentionFlags: OwnerAttentionFlag[] = [];
  const scorecards: OwnerRooftopScorecard[] = rooftops.map((r) => {
    const activeStaff = staffMap.get(r.id) ?? 0;
    const depth = roleDepth.get(r.id) ?? { managers: 0, technicians: 0, advisors: 0 };
    const roVolume7d = ro7Map.get(r.id) ?? 0;
    const roVolume30d = ro30Map.get(r.id) ?? 0;
    const roVolumePrior7d = roPrior7Map.get(r.id) ?? 0;
    const certifiedStories7d = cert7Map.get(r.id) ?? 0;
    const certifiedStories30d = cert30Map.get(r.id) ?? 0;
    const activeIn7d = activeStaffIdsByRooftop.get(r.id)?.size ?? 0;
    const adoptionRatePct =
      activeStaff > 0 ? Math.round((activeIn7d / activeStaff) * 100) : 0;
    const lastAt = lastActivityMap.get(r.id) ?? null;
    const daysSinceActivity = lastAt
      ? (now - lastAt.getTime()) / (24 * 60 * 60 * 1000)
      : Number.POSITIVE_INFINITY;
    const certificationRatePct =
      roVolume7d > 0
        ? Math.min(100, Math.round((certifiedStories7d / roVolume7d) * 1000) / 10)
        : certifiedStories7d > 0
          ? 100
          : null;
    const dayMap = roDayByRooftop.get(r.id) ?? new Map();
    const roDaily14d = dayKeys14.map((k) => dayMap.get(k) ?? 0);
    const staffMustChangePassword = mustChangeMap.get(r.id) ?? 0;
    const aiUsage = aiMap.get(r.id) ?? 0;
    const logins = loginMap.get(r.id) ?? 0;

    const attentionReasons: string[] = [];
    const pushReason = (
      reason: string,
      severity: 'watch' | 'attention',
      category: OwnerAttentionFlag['category']
    ) => {
      attentionReasons.push(reason);
      attentionFlags.push({
        code: reason.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48),
        label: reason,
        severity,
        category,
        dealershipId: r.id,
        dealershipName: r.name,
      });
    };

    if (activeStaff === 0) pushReason('No active staff', 'attention', 'risk');
    if (depth.managers === 0 && activeStaff > 0) {
      pushReason('No active manager', 'attention', 'risk');
    }
    if (depth.managers === 1 && activeStaff >= 4) {
      pushReason('Single-manager coverage risk', 'watch', 'risk');
    }
    if (roVolume7d === 0 && activeStaff > 0) {
      pushReason('No RO activity in 7 days', 'attention', 'ops');
    }
    if (daysSinceActivity > 14) {
      pushReason('No platform activity in 14+ days', 'attention', 'ops');
    }
    if (daysSinceActivity > 7 && daysSinceActivity <= 14 && activeStaff > 0) {
      pushReason('Stale rooftop (7–14 days quiet)', 'watch', 'ops');
    }
    if (adoptionRatePct < 40 && activeStaff >= 2) {
      pushReason('Low adoption (<40%)', 'watch', 'ops');
    }
    if (staffMustChangePassword > 0) {
      pushReason(`${staffMustChangePassword} password change pending`, 'watch', 'compliance');
    }
    if (logins === 0 && activeStaff > 0) {
      pushReason('No staff logins in 7 days', 'attention', 'compliance');
    }
    if (roVolume7d >= 5 && certifiedStories7d === 0) {
      pushReason('ROs without certifications (7d)', 'watch', 'quality');
    }
    if (
      certificationRatePct !== null &&
      certificationRatePct < 25 &&
      roVolume7d >= 3
    ) {
      pushReason(`Low certification rate (${certificationRatePct}%)`, 'watch', 'quality');
    }
    if (aiUsage >= 20 && certifiedStories7d === 0) {
      pushReason('AI usage without certifications', 'watch', 'quality');
    }
    if (roVolumePrior7d > 0 && roVolume7d === 0) {
      pushReason('Volume cliff vs prior week', 'attention', 'ops');
    }

    let status: OwnerRooftopScorecard['status'] = 'healthy';
    const attentionCount = attentionFlags.filter(
      (f) => f.dealershipId === r.id && f.severity === 'attention'
    ).length;
    const watchCount = attentionFlags.filter(
      (f) => f.dealershipId === r.id && f.severity === 'watch'
    ).length;
    if (attentionCount > 0 || activeStaff === 0 || daysSinceActivity > 14) {
      status = 'attention';
    } else if (watchCount > 0 || adoptionRatePct < 60) {
      status = 'watch';
    }

    return {
      dealershipId: r.id,
      name: r.name,
      dealerCode: r.dealerCode,
      dealerName: r.dealerName,
      activeStaff,
      managers: depth.managers,
      technicians: depth.technicians,
      advisors: depth.advisors,
      roVolume7d,
      roVolume30d,
      roVolumePrior7d,
      roVolumeTrendPct: percentChange(roVolume7d, roVolumePrior7d),
      certifiedStories7d,
      certifiedStories30d,
      certificationRatePct,
      aiUsage7d: aiUsage,
      logins7d: logins,
      staffMustChangePassword,
      adoptionRatePct,
      status,
      attentionReasons,
      lastActivityAt: lastAt?.toISOString() ?? null,
      roDaily14d,
    };
  });

  if (mustChangePasswordCount > 0) {
    attentionFlags.push({
      code: 'password_change_pending',
      label: `${mustChangePasswordCount} staff must change temporary password`,
      severity: 'watch',
      category: 'compliance',
    });
  }

  const adoptionRatePct =
    activeUsers > 0 ? Math.round((activeStaffWithActivity7d.length / activeUsers) * 100) : 0;

  const certificationRatePct =
    ro7 > 0 ? Math.min(100, Math.round((cert7 / ro7) * 1000) / 10) : cert7 > 0 ? 100 : null;

  // Portfolio-level Tier 3 exceptions (not tied to a single rooftop card)
  const portfolioVolumeTrend = percentChange(ro7, roPrior7);
  if (portfolioVolumeTrend !== null && portfolioVolumeTrend <= -40 && roPrior7 >= 3) {
    attentionFlags.push({
      code: 'portfolio_volume_drop',
      label: `Portfolio RO volume down ${Math.abs(portfolioVolumeTrend)}% vs prior 7d`,
      severity: 'attention',
      category: 'ops',
    });
  }
  if (medianTimeToCertifyHours !== null && medianTimeToCertifyHours > 48) {
    attentionFlags.push({
      code: 'slow_certification',
      label: `Median time-to-certify is ${medianTimeToCertifyHours}h (target under 48h)`,
      severity: 'watch',
      category: 'quality',
    });
  }
  if (rooftops.length === 0) {
    attentionFlags.push({
      code: 'empty_portfolio',
      label: 'No rooftops in this portfolio — provision or link dealers',
      severity: 'attention',
      category: 'ops',
    });
  }
  if (activeUsers === 0 && rooftops.length > 0) {
    attentionFlags.push({
      code: 'no_portfolio_staff',
      label: 'No active staff across portfolio rooftops',
      severity: 'attention',
      category: 'risk',
    });
  }
  if (logins7d === 0 && activeUsers > 0) {
    attentionFlags.push({
      code: 'no_portfolio_logins',
      label: 'No staff logins across portfolio in 7 days',
      severity: 'attention',
      category: 'compliance',
    });
  }
  if (aiUsage7d >= 50 && cert7 === 0) {
    attentionFlags.push({
      code: 'ai_without_output',
      label: 'High AI usage with zero certifications this week',
      severity: 'watch',
      category: 'quality',
    });
  }

  const seen = new Set<string>();
  const uniqueFlags = attentionFlags
    .filter((f) => {
      const key = `${f.dealershipId ?? ''}:${f.code}:${f.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const sev = (s: string) => (s === 'attention' ? 0 : 1);
      return sev(a.severity) - sev(b.severity) || a.label.localeCompare(b.label);
    });

  const statusRank = (s: OwnerRooftopScorecard['status']) =>
    s === 'attention' ? 0 : s === 'watch' ? 1 : 2;

  return {
    dealerCount,
    dealershipCount: rooftops.length,
    activeUsers,
    repairOrdersLast7Days: ro7,
    repairOrders7d: ro7,
    repairOrders30d: ro30,
    certifiedStories7d: cert7,
    certifiedStories30d: cert30,
    adoptionRatePct,
    attentionFlagCount: uniqueFlags.length,
    attentionFlags: uniqueFlags.slice(0, 40),
    rooftops: scorecards.sort(
      (a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name)
    ),
    recentActivity: activityRows.map((row) => ({
      id: row.id,
      action: row.action,
      dealershipName: row.dealership.name,
      dealerCode: row.dealership.dealer?.code ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
    scopeMode: resolvedScopeMode,
    dealerGroupId: context?.activeDealerGroupId ?? null,
    dealerGroupName: context?.dealerGroupName ?? null,
    volumeTrend: {
      ...volumeTrend,
      // Prefer explicit prior window counts for headline (matches query)
      current7d: ro7,
      prior7d: roPrior7,
      changePct: percentChange(ro7, roPrior7),
    },
    certificationRatePct,
    medianTimeToCertifyHours,
    aiUsage7d,
    logins7d,
    staffMustChangePassword: mustChangePasswordCount,
    certificationTrend,
  };
}

async function loadRooftopRows(dealerIdList: string[] | null): Promise<
  Array<{
    id: string;
    name: string;
    dealerCode: string | null;
    dealerName: string | null;
  }>
> {
  if (dealerIdList) {
    const rows = await getRlsDb().dealership.findMany({
      where: {
        id: { not: APEX_NATIONAL_DEALERSHIP_ID },
        dealerId: { in: dealerIdList },
      },
      select: {
        id: true,
        name: true,
        dealer: { select: { code: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      dealerCode: r.dealer?.code ?? null,
      dealerName: r.dealer?.name ?? null,
    }));
  }

  const rows = await getRlsDb().dealership.findMany({
    where: { id: { not: APEX_NATIONAL_DEALERSHIP_ID } },
    select: {
      id: true,
      name: true,
      dealer: { select: { code: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    dealerCode: r.dealer?.code ?? null,
    dealerName: r.dealer?.name ?? null,
  }));
}
