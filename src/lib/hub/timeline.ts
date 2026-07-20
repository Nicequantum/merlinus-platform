/**
 * Build unified timeline of appointments + voice conversations.
 */

import 'server-only';

import { getRlsDb } from '@/lib/apex/rlsContext';
import { decryptSensitiveText } from '@/lib/encryption';
import {
  mapAppointmentDto,
  parseJsonArray,
  parseJsonObject,
  type TimelineItem,
} from '@/lib/hub/mappers';

export async function buildHubTimeline(input: {
  dealershipId: string;
  from?: Date;
  to?: Date;
  q?: string;
  limit?: number;
}): Promise<{ items: TimelineItem[]; appointmentCount: number; callCount: number }> {
  const db = getRlsDb();
  const limit = Math.min(Math.max(input.limit ?? 80, 1), 200);
  const from = input.from;
  const to = input.to;
  const q = input.q?.trim().toLowerCase();

  const apptWhere: Record<string, unknown> = { dealershipId: input.dealershipId };
  if (from || to) {
    apptWhere.startsAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const callWhere: Record<string, unknown> = { dealershipId: input.dealershipId };
  if (from || to) {
    callWhere.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const [appointments, calls, insights] = await Promise.all([
    db.serviceAppointment.findMany({
      where: apptWhere,
      orderBy: { startsAt: 'desc' },
      take: limit,
    }),
    db.voiceCall.findMany({
      where: callWhere,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        conversation: { select: { activeAgent: true, stateJson: true } },
      },
    }),
    db.conversationInsight.findMany({
      where: { dealershipId: input.dealershipId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const insightByCall = new Map(insights.map((i) => [i.voiceCallId, i]));

  const items: TimelineItem[] = [];

  for (const a of appointments) {
    const dto = mapAppointmentDto(a);
    if (q) {
      const hay = [
        dto.title,
        dto.customerName,
        dto.vehicleLabel,
        dto.advisorName,
        dto.notes,
        dto.category,
        dto.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    items.push({
      kind: 'appointment',
      id: `appt:${a.id}`,
      sortAt: a.startsAt.toISOString(),
      appointment: dto,
    });
  }

  for (const c of calls) {
    const insight = insightByCall.get(c.id);
    let metrics: Record<string, unknown> = {};
    try {
      metrics = JSON.parse(c.metricsJson || '{}') as Record<string, unknown>;
    } catch {
      metrics = {};
    }
    let slots: Record<string, unknown> = {};
    try {
      const state = JSON.parse(c.conversation?.stateJson || '{}') as {
        slots?: Record<string, unknown>;
      };
      slots = state.slots || {};
    } catch {
      slots = {};
    }

    const summary = insight
      ? decryptSensitiveText(insight.summaryEncrypted || '')
      : typeof metrics.callSummary === 'string'
        ? String(metrics.callSummary)
        : null;
    const keyPoints = insight
      ? parseJsonArray(insight.keyPointsJson)
      : [];
    const sentiment =
      insight?.sentiment ||
      (typeof metrics.sentiment === 'string' ? metrics.sentiment : null) ||
      (typeof slots.sentiment === 'string' ? String(slots.sentiment) : null);
    const primaryIntent =
      insight?.primaryIntent ||
      (typeof metrics.primaryIntent === 'string' ? metrics.primaryIntent : null) ||
      (typeof slots.primaryIntent === 'string' ? String(slots.primaryIntent) : null);
    const suggested = insight
      ? parseJsonObject(insight.suggestedAppointmentJson)
      : null;

    if (q) {
      const hay = [
        summary,
        primaryIntent,
        sentiment,
        c.fromLast4,
        c.outcome,
        c.conversation?.activeAgent,
        keyPoints.join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q) && !c.fromLast4.includes(q.replace(/\D/g, ''))) continue;
    }

    items.push({
      kind: 'call',
      id: `call:${c.id}`,
      sortAt: (c.startedAt || c.createdAt).toISOString(),
      call: {
        id: c.id,
        status: c.status,
        fromLast4: c.fromLast4,
        toE164: c.toE164,
        durationSec: c.durationSec,
        outcome: c.outcome,
        contained: c.contained,
        activeAgent: c.conversation?.activeAgent ?? null,
        sentiment,
        primaryIntent,
        summary,
        keyPoints,
        hasInsight: Boolean(insight),
        suggestedAppointment:
          suggested && Object.keys(suggested).length > 0 ? suggested : null,
        createdAt: c.createdAt.toISOString(),
      },
    });
  }

  items.sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0));

  return {
    items: items.slice(0, limit),
    appointmentCount: appointments.length,
    callCount: calls.length,
  };
}
