/**
 * Voice + appointment analytics for the Unified Hub.
 */

import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';

export type HubAnalytics = {
  windowDays: number;
  callVolume: number;
  completedCalls: number;
  avgDurationSec: number | null;
  conversionRate: number | null;
  /** booked appointment linked to voice / outcome staff_followup with work item */
  bookedCount: number;
  transferredCount: number;
  followUpCount: number;
  resolvedCount: number;
  peakHours: Array<{ hour: number; count: number }>;
  intentBreakdown: Record<string, number>;
  agentBreakdown: Record<string, number>;
  sentimentBreakdown: Record<string, number>;
  appointmentsCreated: number;
  appointmentsFromVoice: number;
  insightsGenerated: number;
};

export async function buildHubAnalytics(
  dealershipId: string,
  days = 30
): Promise<HubAnalytics> {
  const db = getRlsDb();
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 3600_000);

  const [calls, appointments, insights] = await Promise.all([
    db.voiceCall.findMany({
      where: { dealershipId, createdAt: { gte: since } },
      select: {
        status: true,
        durationSec: true,
        outcome: true,
        contained: true,
        metricsJson: true,
        routingPathJson: true,
        startedAt: true,
        createdAt: true,
      },
      take: 2000,
    }),
    db.serviceAppointment.findMany({
      where: { dealershipId, createdAt: { gte: since } },
      select: { source: true, voiceCallId: true },
      take: 2000,
    }),
    db.conversationInsight.count({
      where: { dealershipId, createdAt: { gte: since } },
    }),
  ]);

  let durationSum = 0;
  let durationN = 0;
  let bookedCount = 0;
  let transferredCount = 0;
  let followUpCount = 0;
  let resolvedCount = 0;
  let completedCalls = 0;
  const hourCounts = new Array(24).fill(0) as number[];
  const intentBreakdown: Record<string, number> = {};
  const agentBreakdown: Record<string, number> = {};
  const sentimentBreakdown: Record<string, number> = {};

  for (const c of calls) {
    if (c.status === 'completed') completedCalls += 1;
    if (typeof c.durationSec === 'number' && c.durationSec > 0) {
      durationSum += c.durationSec;
      durationN += 1;
    }
    const when = c.startedAt || c.createdAt;
    hourCounts[when.getHours()] += 1;

    const outcome = c.outcome || 'unknown';
    if (outcome === 'transferred_human') transferredCount += 1;
    else if (outcome === 'staff_followup') followUpCount += 1;
    else if (outcome === 'resolved_by_agent') resolvedCount += 1;

    let metrics: Record<string, unknown> = {};
    try {
      metrics = JSON.parse(c.metricsJson || '{}') as Record<string, unknown>;
    } catch {
      metrics = {};
    }
    if (metrics.createdWorkItem === true || outcome === 'staff_followup') {
      bookedCount += 1; // conversion proxy: work item / follow-up
    }
    const intent = typeof metrics.primaryIntent === 'string' ? metrics.primaryIntent : 'unknown';
    intentBreakdown[intent] = (intentBreakdown[intent] || 0) + 1;
    const sentiment = typeof metrics.sentiment === 'string' ? metrics.sentiment : 'unknown';
    sentimentBreakdown[sentiment] = (sentimentBreakdown[sentiment] || 0) + 1;

    try {
      const path = JSON.parse(c.routingPathJson || '[]') as string[];
      for (const a of path) {
        agentBreakdown[a] = (agentBreakdown[a] || 0) + 1;
      }
    } catch {
      // ignore
    }
  }

  const peakHours = hourCounts
    .map((count, hour) => ({ hour, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const callVolume = calls.length;
  return {
    windowDays: days,
    callVolume,
    completedCalls,
    avgDurationSec: durationN > 0 ? Math.round(durationSum / durationN) : null,
    conversionRate: callVolume > 0 ? bookedCount / callVolume : null,
    bookedCount,
    transferredCount,
    followUpCount,
    resolvedCount,
    peakHours,
    intentBreakdown,
    agentBreakdown,
    sentimentBreakdown,
    appointmentsCreated: appointments.length,
    appointmentsFromVoice: appointments.filter(
      (a) => a.source === 'voice_suggestion' || Boolean(a.voiceCallId)
    ).length,
    insightsGenerated: insights,
  };
}
