import 'server-only';

import type { AdvisorPerformanceMetrics, StoryQualityResult } from '@/types';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { lineSoldTotal } from '@/lib/repairLineSoldMetrics';
import { decryptJsonObject } from '@/lib/encryption';

export {
  formatMetricCurrency,
  formatMetricNumber,
  formatMetricPercent,
} from '@/lib/advisorMetricsFormat';

/** MI audit scores at or above this threshold count as warranty "approved" quality. */
export const ADVISOR_APPROVAL_SCORE_THRESHOLD = 75;

/** Phase 7.1 H2 — bound metrics to recent activity (avoid full-history scan). */
export const ADVISOR_METRICS_WINDOW_DAYS = 90;

const EMPTY_METRICS: AdvisorPerformanceMetrics = {
  rosWritten: 0,
  approvalRate: null,
  closingRatio: null,
  avgRepairOrderValue: null,
  totalRevenue: null,
  upsellRate: null,
  csiScore: null,
};

function metricsWindowStart(now = Date.now()): Date {
  return new Date(now - ADVISOR_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function parseAuditScore(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = decryptJsonObject<StoryQualityResult | null>(raw, null);
  return parsed && typeof parsed.score === 'number' ? parsed.score : null;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

type AdvisorAccumulator = {
  rosWritten: number;
  totalLines: number;
  customerPayLines: number;
  auditedLines: number;
  approvedAudits: number;
  warrantyLinesWithStory: number;
  certifiedStories: number;
  soldApprovalLines: number;
  approvedSoldLines: number;
  soldAddOnLines: number;
  addOnLines: number;
  totalRevenue: number;
  roValueCount: number;
  csiScore: number | null;
};

function createAccumulator(csiScore: number | null = null): AdvisorAccumulator {
  return {
    rosWritten: 0,
    totalLines: 0,
    customerPayLines: 0,
    auditedLines: 0,
    approvedAudits: 0,
    warrantyLinesWithStory: 0,
    certifiedStories: 0,
    soldApprovalLines: 0,
    approvedSoldLines: 0,
    soldAddOnLines: 0,
    addOnLines: 0,
    totalRevenue: 0,
    roValueCount: 0,
    csiScore,
  };
}

function finalizeMetrics(acc: AdvisorAccumulator): AdvisorPerformanceMetrics {
  const approvalRate =
    acc.soldApprovalLines > 0
      ? roundPercent((acc.approvedSoldLines / acc.soldApprovalLines) * 100)
      : acc.auditedLines > 0
        ? roundPercent((acc.approvedAudits / acc.auditedLines) * 100)
        : null;
  const closingRatio =
    acc.warrantyLinesWithStory > 0
      ? roundPercent((acc.certifiedStories / acc.warrantyLinesWithStory) * 100)
      : null;
  const upsellRate =
    acc.soldAddOnLines > 0
      ? roundPercent((acc.addOnLines / acc.soldAddOnLines) * 100)
      : acc.totalLines > 0
        ? roundPercent((acc.customerPayLines / acc.totalLines) * 100)
        : null;
  const totalRevenue = acc.totalRevenue > 0 ? roundCurrency(acc.totalRevenue) : null;
  const avgRepairOrderValue =
    acc.roValueCount > 0 ? roundCurrency(acc.totalRevenue / acc.roValueCount) : null;

  return {
    rosWritten: acc.rosWritten,
    approvalRate,
    closingRatio,
    avgRepairOrderValue,
    totalRevenue,
    upsellRate,
    csiScore: acc.csiScore,
  };
}

/** Batch-compute dealership performance metrics for one or more service advisors. */
export async function computeAdvisorMetricsBatch(
  dealershipId: string,
  advisorIds: string[],
  csiByAdvisorId: Map<string, number | null> = new Map()
): Promise<Map<string, AdvisorPerformanceMetrics>> {
  const result = new Map<string, AdvisorPerformanceMetrics>();
  if (advisorIds.length === 0) return result;

  for (const id of advisorIds) {
    result.set(id, { ...EMPTY_METRICS, csiScore: csiByAdvisorId.get(id) ?? null });
  }

  const since = metricsWindowStart();
  const db = getRlsDb();

  // Phase 7.1 H2 — last 90 days only; drop full warranty story body from select
  const repairOrders = await db.repairOrder.findMany({
    where: {
      dealershipId,
      serviceAdvisorId: { in: advisorIds },
      updatedAt: { gte: since },
    },
    select: {
      id: true,
      serviceAdvisorId: true,
      repairLines: {
        select: {
          id: true,
          isCustomerPay: true,
          storyQualityAuditEncrypted: true,
          warrantyStoryEncrypted: true,
          soldLaborHours: true,
          soldLaborAmount: true,
          soldPartsAmount: true,
          customerApproved: true,
          isAddOn: true,
        },
      },
    },
  });

  const accumulators = new Map<string, AdvisorAccumulator>();
  for (const id of advisorIds) {
    accumulators.set(id, createAccumulator(csiByAdvisorId.get(id) ?? null));
  }

  for (const ro of repairOrders) {
    const advisorId = ro.serviceAdvisorId;
    if (!advisorId) continue;
    const acc = accumulators.get(advisorId);
    if (!acc) continue;

    acc.rosWritten += 1;
    let roSoldTotal = 0;

    for (const line of ro.repairLines) {
      acc.totalLines += 1;
      const soldTotal = lineSoldTotal(line);
      if (soldTotal > 0) {
        roSoldTotal += soldTotal;
        acc.totalRevenue += soldTotal;
      }

      if (line.customerApproved != null) {
        acc.soldApprovalLines += 1;
        if (line.customerApproved) acc.approvedSoldLines += 1;
      }

      if (line.isAddOn != null) {
        acc.soldAddOnLines += 1;
        if (line.isAddOn) acc.addOnLines += 1;
      }

      if (line.isCustomerPay) {
        acc.customerPayLines += 1;
        continue;
      }

      const hasStory = Boolean(line.warrantyStoryEncrypted?.trim());
      if (hasStory) {
        acc.warrantyLinesWithStory += 1;
      }

      const score = parseAuditScore(line.storyQualityAuditEncrypted ?? '');
      if (score != null) {
        acc.auditedLines += 1;
        if (score >= ADVISOR_APPROVAL_SCORE_THRESHOLD) {
          acc.approvedAudits += 1;
        }
      }
    }

    if (roSoldTotal > 0) {
      acc.roValueCount += 1;
    }
  }

  // Certified stories in the same window, joined to advisors via a single RO lookup
  const certifiedStories = await db.technicianCertifiedStory.findMany({
    where: {
      dealershipId,
      certifiedAt: { gte: since },
    },
    select: { repairOrderId: true },
  });

  if (certifiedStories.length > 0) {
    const certifiedRoIds = [...new Set(certifiedStories.map((story) => story.repairOrderId))];
    const certifiedRos = await db.repairOrder.findMany({
      where: {
        id: { in: certifiedRoIds },
        serviceAdvisorId: { in: advisorIds },
      },
      select: { id: true, serviceAdvisorId: true },
    });
    const advisorByRoId = new Map(
      certifiedRos.map((ro) => [ro.id, ro.serviceAdvisorId] as const)
    );

    for (const story of certifiedStories) {
      const advisorId = advisorByRoId.get(story.repairOrderId);
      if (!advisorId) continue;
      const acc = accumulators.get(advisorId);
      if (acc) acc.certifiedStories += 1;
    }
  }

  for (const [id, acc] of accumulators) {
    result.set(id, finalizeMetrics(acc));
  }

  return result;
}

/** Exported for tests — finalize a single accumulator into API metrics. */
export function buildAdvisorMetricsFromAccumulator(acc: AdvisorAccumulator): AdvisorPerformanceMetrics {
  return finalizeMetrics(acc);
}

export function roundAdvisorCurrency(value: number): number {
  return roundCurrency(value);
}
