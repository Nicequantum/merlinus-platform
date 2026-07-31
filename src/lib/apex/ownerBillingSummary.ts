/**
 * National owner billing / metered usage — PII-free portfolio rollup.
 *
 * Sources (existing meters, no dual-write risk):
 *  - UsageEvent.story_generated → first billable AI story per repair line
 *  - AuditLog story.* / video.sms_send / diagnostics.extract → activity volume
 *  - UsageLog → AI route hits (cap / cost proxy)
 *
 * Pricing is estimate-only (env-driven). Invoices stay out of band until finance closes.
 */
import 'server-only';

import { Prisma } from '@prisma/client';
import { listDealerIdsForOwnerGroups } from '@/lib/apex/dealerGroupAccess';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import type { OwnerSummaryContext } from '@/lib/apex/ownerNationalSummary';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Billable first-story unit (UsageEvent). */
export const BILLING_STORY_EVENT = 'story_generated' as const;

export type OwnerBillingPeriod = '7d' | '30d' | 'month';

export interface OwnerBillingRates {
  /** Platform subscription per rooftop / month (cents). */
  platformMonthlyCents: number;
  /** Default per first-story fee (cents). */
  storyFirstCents: number;
  /** High-volume per first-story fee (cents). */
  storyHighVolumeCents: number;
  /** Monthly first-story count that unlocks high-volume rate. */
  highVolumeThreshold: number;
  /** Estimated cost per story regeneration (cents) — token recoup, often lower. */
  storyRegenCents: number;
  /** Estimated cost per customer SMS (cents). */
  smsCents: number;
  /** Currency label for UI. */
  currency: string;
}

export interface OwnerRooftopBillingRow {
  dealershipId: string;
  name: string;
  dealerCode: string | null;
  dealerName: string | null;
  /** First AI story on a line (billable unit). */
  storiesFirst: number;
  /** Additional story.generate audits after first (token cost proxy). */
  storiesRegen: number;
  /** Total story.generate audit events. */
  storiesGeneratedTotal: number;
  storyReviews: number;
  storyScores: number;
  storyEdits: number;
  storyCertifications: number;
  storyPdfExports: number;
  visionExtracts: number;
  smsSends: number;
  aiRouteHits: number;
  /** Estimated variable fees for the period (cents). */
  estimatedStoryFeesCents: number;
  estimatedRegenFeesCents: number;
  estimatedSmsFeesCents: number;
  /** Platform fee pro-rated for period (cents). */
  estimatedPlatformFeeCents: number;
  /** Sum of estimates (cents). */
  estimatedTotalCents: number;
}

export interface OwnerBillingSummary {
  generatedAt: string;
  period: OwnerBillingPeriod;
  periodStart: string;
  periodEnd: string;
  scopeMode: 'national' | 'group';
  dealerGroupId: string | null;
  dealerGroupName: string | null;
  rates: OwnerBillingRates;
  totals: {
    rooftops: number;
    storiesFirst: number;
    storiesRegen: number;
    storiesGeneratedTotal: number;
    storyReviews: number;
    storyScores: number;
    storyEdits: number;
    storyCertifications: number;
    storyPdfExports: number;
    visionExtracts: number;
    smsSends: number;
    aiRouteHits: number;
    estimatedStoryFeesCents: number;
    estimatedRegenFeesCents: number;
    estimatedSmsFeesCents: number;
    estimatedPlatformFeeCents: number;
    estimatedTotalCents: number;
  };
  rooftops: OwnerRooftopBillingRow[];
  /** Daily first-story billable units (portfolio) for sparkline. */
  dailyBillableStories: Array<{ day: string; count: number }>;
  notes: string[];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Fair default packaging for MB fixed-ops warranty narratives:
 *  - modest platform fee covers hosting, audit, support
 *  - per first-story fee covers Grok + ops margin
 *  - regen cheaper (same line, already billed unit) to avoid punishing edits
 *  - SMS pass-through with small margin
 *
 * Override via Worker secrets without redeploying UI.
 */
export function resolveBillingRates(env: NodeJS.ProcessEnv = process.env): OwnerBillingRates {
  return {
    platformMonthlyCents: parsePositiveInt(env.BILLING_PLATFORM_MONTHLY_CENTS, 29_900), // $299
    storyFirstCents: parsePositiveInt(env.BILLING_STORY_FIRST_CENTS, 95), // $0.95
    storyHighVolumeCents: parsePositiveInt(env.BILLING_STORY_HIGH_VOLUME_CENTS, 65), // $0.65
    highVolumeThreshold: parsePositiveInt(env.BILLING_HIGH_VOLUME_THRESHOLD, 400),
    storyRegenCents: parsePositiveInt(env.BILLING_STORY_REGEN_CENTS, 25), // $0.25
    smsCents: parsePositiveInt(env.BILLING_SMS_CENTS, 4), // $0.04
    currency: (env.BILLING_CURRENCY?.trim() || 'USD').toUpperCase(),
  };
}

function periodWindow(period: OwnerBillingPeriod, now = new Date()): { start: Date; end: Date; fractionOfMonth: number } {
  const end = now;
  if (period === '7d') {
    return { start: new Date(end.getTime() - 7 * DAY_MS), end, fractionOfMonth: 7 / 30 };
  }
  if (period === '30d') {
    return { start: new Date(end.getTime() - 30 * DAY_MS), end, fractionOfMonth: 1 };
  }
  // calendar month UTC
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, end.getUTCDate());
  return { start, end, fractionOfMonth: elapsed / daysInMonth };
}

function storyUnitRate(firstCount: number, rates: OwnerBillingRates): number {
  return firstCount >= rates.highVolumeThreshold ? rates.storyHighVolumeCents : rates.storyFirstCents;
}

async function resolveBillingDealerScope(context?: OwnerSummaryContext): Promise<{
  isGroupScoped: boolean;
  dealerIdList: string[] | null;
  scopeMode: 'national' | 'group';
}> {
  if (!context?.technicianId) {
    return { isGroupScoped: false, dealerIdList: null, scopeMode: 'national' };
  }
  const scopedDealerIds = await listDealerIdsForOwnerGroups(context.technicianId);
  if (scopedDealerIds === null) {
    return { isGroupScoped: false, dealerIdList: null, scopeMode: 'national' };
  }
  const dealerIdList = scopedDealerIds.length > 0 ? scopedDealerIds : (['__none__'] as string[]);
  return { isGroupScoped: true, dealerIdList, scopeMode: 'group' };
}

async function loadBillingRooftops(dealerIdList: string[] | null) {
  const where =
    dealerIdList == null
      ? { id: { not: APEX_NATIONAL_DEALERSHIP_ID } }
      : {
          id: { not: APEX_NATIONAL_DEALERSHIP_ID },
          dealerId: { in: dealerIdList },
        };
  const rows = await getRlsDb().dealership.findMany({
    where,
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

function emptyCounters() {
  return {
    storiesFirst: 0,
    storiesGeneratedTotal: 0,
    storyReviews: 0,
    storyScores: 0,
    storyEdits: 0,
    storyCertifications: 0,
    storyPdfExports: 0,
    visionExtracts: 0,
    smsSends: 0,
    aiRouteHits: 0,
  };
}

async function computeOwnerBillingSummary(
  context: OwnerSummaryContext | undefined,
  period: OwnerBillingPeriod
): Promise<OwnerBillingSummary> {
  const rates = resolveBillingRates();
  const { start, end, fractionOfMonth } = periodWindow(period);
  const { dealerIdList, scopeMode } = await resolveBillingDealerScope(context);
  const rooftops = await loadBillingRooftops(dealerIdList);
  const rooftopIds = rooftops.map((r) => r.id);
  const effectiveIds = rooftopIds.length > 0 ? rooftopIds : ['__none__'];

  const byId = new Map(rooftops.map((r) => [r.id, emptyCounters()]));

  // First billable stories
  const firstStories = await getRlsDb().usageEvent.groupBy({
    by: ['dealershipId'],
    where: {
      dealershipId: { in: effectiveIds },
      eventType: BILLING_STORY_EVENT,
      createdAt: { gte: start, lte: end },
    },
    _count: { _all: true },
  });
  for (const row of firstStories) {
    const c = byId.get(row.dealershipId);
    if (c) c.storiesFirst = row._count._all;
  }

  // Audit volume by action
  const auditActions = [
    'story.generate',
    'story.review',
    'story.score',
    'story.edit',
    'story.certify',
    'story.pdf_export',
    'diagnostics.extract',
    'video.sms_send',
  ] as const;
  const auditGroups = await getRlsDb().auditLog.groupBy({
    by: ['dealershipId', 'action'],
    where: {
      dealershipId: { in: effectiveIds },
      createdAt: { gte: start, lte: end },
      action: { in: [...auditActions] },
    },
    _count: { _all: true },
  });
  for (const row of auditGroups) {
    const c = byId.get(row.dealershipId);
    if (!c) continue;
    const n = row._count._all;
    switch (row.action) {
      case 'story.generate':
        c.storiesGeneratedTotal = n;
        break;
      case 'story.review':
        c.storyReviews = n;
        break;
      case 'story.score':
        c.storyScores = n;
        break;
      case 'story.edit':
        c.storyEdits = n;
        break;
      case 'story.certify':
        c.storyCertifications = n;
        break;
      case 'story.pdf_export':
        c.storyPdfExports = n;
        break;
      case 'diagnostics.extract':
        c.visionExtracts = n;
        break;
      case 'video.sms_send':
        c.smsSends = n;
        break;
      default:
        break;
    }
  }

  // AI route hits (UsageLog)
  const usageGroups = await getRlsDb().usageLog.groupBy({
    by: ['dealershipId'],
    where: {
      dealershipId: { in: effectiveIds },
      createdAt: { gte: start, lte: end },
    },
    _count: { _all: true },
  });
  for (const row of usageGroups) {
    const c = byId.get(row.dealershipId);
    if (c) c.aiRouteHits = row._count._all;
  }

  // Daily billable series (portfolio)
  let dailyBillableStories: Array<{ day: string; count: number }> = [];
  if (rooftopIds.length > 0) {
    const idList = Prisma.join(rooftopIds.map((id) => Prisma.sql`${id}`));
    const buckets = await getRlsDb().$queryRaw<Array<{ day: string; count: number }>>`
      SELECT date("created_at") AS day, COUNT(*) AS count
      FROM "usage_events"
      WHERE "dealership_id" IN (${idList})
        AND "event_type" = ${BILLING_STORY_EVENT}
        AND "created_at" >= ${start}
        AND "created_at" <= ${end}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    dailyBillableStories = buckets.map((b) => ({
      day: String(b.day).slice(0, 10),
      count: Number(b.count) || 0,
    }));
  }

  const rows: OwnerRooftopBillingRow[] = rooftops.map((r) => {
    const c = byId.get(r.id) ?? emptyCounters();
    const regen = Math.max(0, c.storiesGeneratedTotal - c.storiesFirst);
    const unit = storyUnitRate(c.storiesFirst, rates);
    const estimatedStoryFeesCents = c.storiesFirst * unit;
    const estimatedRegenFeesCents = regen * rates.storyRegenCents;
    const estimatedSmsFeesCents = c.smsSends * rates.smsCents;
    const estimatedPlatformFeeCents = Math.round(rates.platformMonthlyCents * fractionOfMonth);
    const estimatedTotalCents =
      estimatedStoryFeesCents +
      estimatedRegenFeesCents +
      estimatedSmsFeesCents +
      estimatedPlatformFeeCents;
    return {
      dealershipId: r.id,
      name: r.name,
      dealerCode: r.dealerCode,
      dealerName: r.dealerName,
      storiesFirst: c.storiesFirst,
      storiesRegen: regen,
      storiesGeneratedTotal: c.storiesGeneratedTotal,
      storyReviews: c.storyReviews,
      storyScores: c.storyScores,
      storyEdits: c.storyEdits,
      storyCertifications: c.storyCertifications,
      storyPdfExports: c.storyPdfExports,
      visionExtracts: c.visionExtracts,
      smsSends: c.smsSends,
      aiRouteHits: c.aiRouteHits,
      estimatedStoryFeesCents,
      estimatedRegenFeesCents,
      estimatedSmsFeesCents,
      estimatedPlatformFeeCents,
      estimatedTotalCents,
    };
  });

  rows.sort((a, b) => b.estimatedTotalCents - a.estimatedTotalCents || a.name.localeCompare(b.name));

  const sum = (pick: (r: OwnerRooftopBillingRow) => number) =>
    rows.reduce((acc, r) => acc + pick(r), 0);

  return {
    generatedAt: new Date().toISOString(),
    period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    scopeMode,
    dealerGroupId: context?.activeDealerGroupId ?? null,
    dealerGroupName: context?.dealerGroupName ?? null,
    rates,
    totals: {
      rooftops: rows.length,
      storiesFirst: sum((r) => r.storiesFirst),
      storiesRegen: sum((r) => r.storiesRegen),
      storiesGeneratedTotal: sum((r) => r.storiesGeneratedTotal),
      storyReviews: sum((r) => r.storyReviews),
      storyScores: sum((r) => r.storyScores),
      storyEdits: sum((r) => r.storyEdits),
      storyCertifications: sum((r) => r.storyCertifications),
      storyPdfExports: sum((r) => r.storyPdfExports),
      visionExtracts: sum((r) => r.visionExtracts),
      smsSends: sum((r) => r.smsSends),
      aiRouteHits: sum((r) => r.aiRouteHits),
      estimatedStoryFeesCents: sum((r) => r.estimatedStoryFeesCents),
      estimatedRegenFeesCents: sum((r) => r.estimatedRegenFeesCents),
      estimatedSmsFeesCents: sum((r) => r.estimatedSmsFeesCents),
      estimatedPlatformFeeCents: sum((r) => r.estimatedPlatformFeeCents),
      estimatedTotalCents: sum((r) => r.estimatedTotalCents),
    },
    rooftops: rows,
    dailyBillableStories,
    notes: [
      'Billable unit = first AI warranty story per repair line (UsageEvent story_generated).',
      'Regenerations = story.generate audits minus first-story units (token recoup estimate).',
      'Customer Pay templates do not consume story_generated billable units.',
      'Estimates are not invoices — rates are configurable via BILLING_* Worker secrets.',
      `High-volume story rate ($${(rates.storyHighVolumeCents / 100).toFixed(2)}) applies when a rooftop exceeds ${rates.highVolumeThreshold} first stories in the selected window.`,
    ],
  };
}

export async function getOwnerBillingSummary(
  context?: OwnerSummaryContext,
  period: OwnerBillingPeriod = '30d'
): Promise<OwnerBillingSummary> {
  return withRlsBypass(async () => computeOwnerBillingSummary(context, period));
}

export function parseBillingPeriod(raw: string | null | undefined): OwnerBillingPeriod {
  const v = (raw || '').trim().toLowerCase();
  if (v === '7d' || v === '7') return '7d';
  if (v === 'month' || v === 'calendar' || v === 'mtd') return 'month';
  return '30d';
}
