/**
 * PR-M5a/b — multi-turn agent loop (receptionist → specialists).
 */

import 'server-only';

import { encryptSensitiveText } from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { grokVoiceChat, type VoiceChatMessage } from '@/lib/voiceAgent/grokClient';
import {
  finalizeCallMetrics,
  recordTurnAgent,
} from '@/lib/voiceAgent/metrics';
import { systemPromptForAgent } from '@/lib/voiceAgent/personas';
import { executeVoiceTool, VOICE_TOOL_DEFINITIONS } from '@/lib/voiceAgent/tools';
import type {
  AgentTurnResult,
  ConversationState,
  VoiceAgentName,
} from '@/lib/voiceAgent/types';
import {
  emptyCallMetrics,
  emptyConversationState,
  isVoiceAgentName,
} from '@/lib/voiceAgent/types';

const MAX_TOOL_ROUNDS = 5;

export function parseConversationState(raw: string | null | undefined): ConversationState {
  try {
    const parsed = JSON.parse(raw || '{}') as ConversationState;
    return {
      slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : {},
      routingPath: Array.isArray(parsed.routingPath) ? parsed.routingPath : ['receptionist'],
      turnCount: typeof parsed.turnCount === 'number' ? parsed.turnCount : 0,
      lastToolResults: Array.isArray(parsed.lastToolResults) ? parsed.lastToolResults : [],
      handoffs: Array.isArray(parsed.handoffs) ? parsed.handoffs : [],
      metrics: parsed.metrics && typeof parsed.metrics === 'object' ? parsed.metrics : emptyCallMetrics(),
    };
  } catch {
    return emptyConversationState();
  }
}

export async function appendTranscriptSegment(input: {
  callId: string;
  speaker: 'agent' | 'caller' | 'system';
  text: string;
  agentName?: string;
  tsMs?: number;
}): Promise<void> {
  if (!input.text.trim()) return;
  await getRlsDb().voiceTranscriptSegment.create({
    data: {
      callId: input.callId,
      speaker: input.speaker,
      textEncrypted: encryptSensitiveText(input.text.trim()),
      agentName: input.agentName || null,
      tsMs: input.tsMs ?? Date.now() % 1_000_000_000,
    },
  });
}

function buildSystemContent(
  agent: VoiceAgentName,
  dealershipName: string,
  state: ConversationState
): string {
  const handoff = state.slots.handoffBrief
    ? `\nHandoff brief from previous agent: ${state.slots.handoffBrief}`
    : '';
  return `${systemPromptForAgent(agent, dealershipName)}

Current slots (JSON): ${JSON.stringify(state.slots)}
Routing path: ${state.routingPath.join(' → ')}
Handoffs: ${(state.handoffs || []).length}
Turn: ${state.turnCount}${handoff}`;
}

export async function processAgentTurn(input: {
  dealershipId: string;
  dealershipName: string;
  callId: string;
  callerUtterance: string;
  activeAgent: VoiceAgentName;
  state: ConversationState;
}): Promise<AgentTurnResult> {
  let activeAgent = input.activeAgent;
  let state: ConversationState = parseConversationState(JSON.stringify(input.state));
  state.turnCount = (state.turnCount || 0) + 1;
  recordTurnAgent(state, activeAgent);

  if (!state.routingPath.length) state.routingPath = ['receptionist'];

  await appendTranscriptSegment({
    callId: input.callId,
    speaker: 'caller',
    text: input.callerUtterance,
  });

  const messages: VoiceChatMessage[] = [
    {
      role: 'system',
      content: buildSystemContent(activeAgent, input.dealershipName, state),
    },
    {
      role: 'user',
      content: input.callerUtterance.trim() || '(no speech detected)',
    },
  ];

  let endCall = false;
  let speech = '';
  let lastFarewell: string | undefined;
  let transferredHuman = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await grokVoiceChat({
      messages,
      tools: VOICE_TOOL_DEFINITIONS,
      temperature: 0.3,
      maxTokens: 450,
    });

    if (reply.toolCalls.length === 0) {
      speech = reply.content || speech || 'How can I help you today?';
      break;
    }

    messages.push({
      role: 'assistant',
      content: reply.content || null,
      tool_calls: reply.toolCalls,
    });

    for (const tc of reply.toolCalls) {
      const executed = await executeVoiceTool(tc.function.name, tc.function.arguments, {
        dealershipId: input.dealershipId,
        callId: input.callId,
        state,
        activeAgent,
      });
      state = executed.state;
      if (executed.activeAgent !== activeAgent) {
        activeAgent = executed.activeAgent;
        recordTurnAgent(state, activeAgent);
      }
      if (executed.endCall) {
        endCall = true;
        lastFarewell = executed.farewell;
      }
      if (executed.transferredHuman) transferredHuman = true;
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(executed.result),
      });
    }

    if (round < MAX_TOOL_ROUNDS - 1) {
      messages[0] = {
        role: 'system',
        content: buildSystemContent(activeAgent, input.dealershipName, state),
      };
    }

    if (endCall) {
      speech = lastFarewell || reply.content || 'Thank you for calling. Goodbye.';
      break;
    }
  }

  if (!speech) {
    speech = endCall
      ? lastFarewell || 'Thank you for calling. Goodbye.'
      : 'Thanks — how else can I help?';
  }

  await appendTranscriptSegment({
    callId: input.callId,
    speaker: 'agent',
    text: speech,
    agentName: activeAgent,
  });

  const metrics = endCall
    ? finalizeCallMetrics(state, { endCall: true, transferredHuman })
    : state.metrics || emptyCallMetrics();
  state.metrics = metrics;

  // Full-text rollup for search (encrypted)
  const rollup = await buildEncryptedTranscriptRollup(input.callId);

  await getRlsDb().voiceConversation.updateMany({
    where: { callId: input.callId },
    data: {
      activeAgent,
      stateJson: JSON.stringify(state),
    },
  });
  await getRlsDb().voiceCall.update({
    where: { id: input.callId },
    data: {
      routingPathJson: JSON.stringify(state.routingPath),
      metricsJson: JSON.stringify(metrics),
      status: endCall ? 'completed' : 'in_progress',
      ...(endCall
        ? {
            endedAt: new Date(),
            contained: metrics.contained ?? null,
            outcome: metrics.outcome ?? null,
          }
        : {}),
      ...(rollup ? { transcriptEncrypted: rollup } : {}),
    },
  });

  return { speech, activeAgent, endCall, state };
}

async function buildEncryptedTranscriptRollup(callId: string): Promise<string | null> {
  const { decryptSensitiveText } = await import('@/lib/encryption');
  const segments = await getRlsDb().voiceTranscriptSegment.findMany({
    where: { callId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  if (segments.length === 0) return null;
  const text = segments
    .map((s) => {
      const body = decryptSensitiveText(s.textEncrypted || '');
      const who = s.speaker === 'agent' ? `agent:${s.agentName || 'unknown'}` : s.speaker;
      return `[${who}] ${body}`;
    })
    .join('\n');
  return encryptSensitiveText(text);
}

export async function buildOpeningGreeting(dealershipName: string): Promise<string> {
  return `Thank you for calling ${dealershipName}. This is the virtual receptionist. Are you calling about parts, service, sales, or a loaner vehicle?`;
}

export function normalizeAgentName(value: string | null | undefined): VoiceAgentName {
  if (value && isVoiceAgentName(value)) return value;
  return 'receptionist';
}
