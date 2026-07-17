/**
 * PR-M5b — containment and quality metrics for voice calls.
 */

import type { CallMetrics, ConversationState, VoiceAgentName } from '@/lib/voiceAgent/types';
import { emptyCallMetrics } from '@/lib/voiceAgent/types';

export function ensureMetrics(state: ConversationState): CallMetrics {
  if (state.metrics) return state.metrics;
  state.metrics = emptyCallMetrics();
  return state.metrics;
}

export function recordTurnAgent(state: ConversationState, agent: VoiceAgentName): void {
  const m = ensureMetrics(state);
  if (agent === 'receptionist') m.receptionistTurns += 1;
  else m.specialistTurns += 1;
}

export function recordToolResult(state: ConversationState, ok: boolean): void {
  const m = ensureMetrics(state);
  if (ok) m.toolSuccessCount += 1;
  else m.toolFailureCount += 1;
}

export function recordHandoff(state: ConversationState): void {
  const m = ensureMetrics(state);
  m.handoffCount += 1;
}

export function recordWorkItem(state: ConversationState): void {
  const m = ensureMetrics(state);
  m.createdWorkItem = true;
}

/**
 * Finalize outcome when the call ends.
 * Contained = agent closed the loop (end_call) with a work item OR pure FAQ path
 * without needing human transfer flags.
 */
export function finalizeCallMetrics(
  state: ConversationState,
  options: { endCall: boolean; transferredHuman?: boolean }
): CallMetrics {
  const m = ensureMetrics(state);
  if (options.transferredHuman) {
    m.outcome = 'transferred_human';
    m.contained = false;
  } else if (options.endCall && m.createdWorkItem) {
    m.outcome = 'staff_followup';
    // Contained from the caller's perspective: they did not need to hold for a person
    m.contained = true;
  } else if (options.endCall && m.handoffCount === 0 && !m.createdWorkItem) {
    m.outcome = 'resolved_by_agent';
    m.contained = true;
  } else if (options.endCall) {
    m.outcome = 'resolved_by_agent';
    m.contained = true;
  } else {
    m.outcome = 'incomplete';
    m.contained = false;
  }
  return m;
}

export type AggregateVoiceMetrics = {
  totalCalls: number;
  completedCalls: number;
  containedCalls: number;
  containmentRate: number | null;
  avgHandoffs: number | null;
  avgTurns: number | null;
  workItemRate: number | null;
  outcomes: Record<string, number>;
  agentShare: Record<string, number>;
};

export function aggregateFromCallRows(
  rows: Array<{
    status: string;
    contained: boolean | null;
    outcome: string | null;
    metricsJson: string;
    routingPathJson: string;
  }>
): AggregateVoiceMetrics {
  const outcomes: Record<string, number> = {};
  const agentShare: Record<string, number> = {};
  let containedCalls = 0;
  let handoffSum = 0;
  let turnSum = 0;
  let workItems = 0;
  let metricN = 0;
  let completedCalls = 0;

  for (const row of rows) {
    if (row.status === 'completed') completedCalls += 1;
    if (row.contained === true) containedCalls += 1;
    const outcome = row.outcome || 'unknown';
    outcomes[outcome] = (outcomes[outcome] || 0) + 1;

    try {
      const metrics = JSON.parse(row.metricsJson || '{}') as CallMetrics;
      if (typeof metrics.handoffCount === 'number') {
        handoffSum += metrics.handoffCount;
        metricN += 1;
      }
      if (typeof metrics.receptionistTurns === 'number' && typeof metrics.specialistTurns === 'number') {
        turnSum += metrics.receptionistTurns + metrics.specialistTurns;
      }
      if (metrics.createdWorkItem) workItems += 1;
    } catch {
      // ignore
    }

    try {
      const path = JSON.parse(row.routingPathJson || '[]') as string[];
      for (const agent of path) {
        agentShare[agent] = (agentShare[agent] || 0) + 1;
      }
    } catch {
      // ignore
    }
  }

  const totalCalls = rows.length;
  return {
    totalCalls,
    completedCalls,
    containedCalls,
    containmentRate: totalCalls > 0 ? containedCalls / totalCalls : null,
    avgHandoffs: metricN > 0 ? handoffSum / metricN : null,
    avgTurns: metricN > 0 ? turnSum / metricN : null,
    workItemRate: totalCalls > 0 ? workItems / totalCalls : null,
    outcomes,
    agentShare,
  };
}
