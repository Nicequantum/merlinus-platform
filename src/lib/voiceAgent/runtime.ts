/**
 * Sophia multi-turn agent loop — conversation memory, tools, rich call logging.
 */

import 'server-only';

import { encryptSensitiveText, decryptSensitiveText } from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import {
  buildSophiaWelcome,
  resolveDealershipContext,
  type DealershipContext,
} from '@/lib/voiceAgent/dealershipContext';
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
import { logger } from '@/lib/logger';

const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_SEGMENTS = 16;

export type AgentTurnResultExtended = AgentTurnResult & {
  dialHumanE164?: string;
};

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
  state: ConversationState,
  dealershipContext: DealershipContext
): string {
  const handoff = state.slots.handoffBrief
    ? `\nHandoff brief from previous agent: ${state.slots.handoffBrief}`
    : '';
  const sentiment = state.slots.sentiment ? `\nCaller sentiment: ${state.slots.sentiment}` : '';
  return `${systemPromptForAgent(agent, dealershipName, dealershipContext)}

Current slots (JSON): ${JSON.stringify(state.slots)}
Routing path: ${state.routingPath.join(' → ')}
Handoffs: ${(state.handoffs || []).length}
Turn: ${state.turnCount}${handoff}${sentiment}`;
}

async function loadRecentHistory(callId: string): Promise<VoiceChatMessage[]> {
  const segments = await getRlsDb().voiceTranscriptSegment.findMany({
    where: { callId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_SEGMENTS,
  });
  const chronological = segments.reverse();
  const messages: VoiceChatMessage[] = [];
  for (const seg of chronological) {
    const text = decryptSensitiveText(seg.textEncrypted || '').trim();
    if (!text) continue;
    if (seg.speaker === 'caller') {
      messages.push({ role: 'user', content: text });
    } else if (seg.speaker === 'agent') {
      messages.push({ role: 'assistant', content: text });
    }
  }
  return messages;
}

export async function processAgentTurn(input: {
  dealershipId: string;
  dealershipName: string;
  callId: string;
  callerUtterance: string;
  activeAgent: VoiceAgentName;
  state: ConversationState;
  toE164?: string | null;
  dealershipContext?: DealershipContext;
}): Promise<AgentTurnResultExtended> {
  let activeAgent = input.activeAgent;
  let state: ConversationState = parseConversationState(JSON.stringify(input.state));
  state.turnCount = (state.turnCount || 0) + 1;
  recordTurnAgent(state, activeAgent);

  if (!state.routingPath.length) state.routingPath = ['receptionist'];

  const dealershipContext =
    input.dealershipContext ||
    resolveDealershipContext({
      dealershipId: input.dealershipId,
      dealershipName: input.dealershipName,
      toE164: input.toE164,
    });

  ensureMetricsAgentName(state, dealershipContext.agentDisplayName || 'Sophia');

  const utterance = input.callerUtterance.trim() || '(no speech detected)';
  await appendTranscriptSegment({
    callId: input.callId,
    speaker: 'caller',
    text: utterance,
  });

  const history = await loadRecentHistory(input.callId);
  // History already includes the just-saved caller line if transaction visible; if not, append.
  const last = history[history.length - 1];
  if (!last || last.role !== 'user' || last.content !== utterance) {
    history.push({ role: 'user', content: utterance });
  }

  const messages: VoiceChatMessage[] = [
    {
      role: 'system',
      content: buildSystemContent(activeAgent, input.dealershipName, state, dealershipContext),
    },
    ...history.slice(-MAX_HISTORY_SEGMENTS),
  ];

  let endCall = false;
  let speech = '';
  let lastFarewell: string | undefined;
  let transferredHuman = false;
  let dialHumanE164: string | undefined;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const reply = await grokVoiceChat({
        messages,
        tools: VOICE_TOOL_DEFINITIONS,
        temperature: 0.35,
        maxTokens: 520,
      });

      if (reply.toolCalls.length === 0) {
        speech = reply.content || speech || recoverySpeech(dealershipContext);
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
          dealershipContext,
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
        if (executed.transferredHuman) {
          transferredHuman = true;
          if (executed.dialHumanE164) dialHumanE164 = executed.dialHumanE164;
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(executed.result),
        });
      }

      if (round < MAX_TOOL_ROUNDS - 1) {
        messages[0] = {
          role: 'system',
          content: buildSystemContent(activeAgent, input.dealershipName, state, dealershipContext),
        };
      }

      if (endCall || dialHumanE164) {
        speech =
          lastFarewell ||
          reply.content ||
          (dialHumanE164
            ? `Of course. Please hold while I connect you with a team member.`
            : politeClose(dealershipContext));
        break;
      }
    }
  } catch (error) {
    logger.warn('voice.agent_turn_error', {
      callId: input.callId,
      error: error instanceof Error ? error.message : String(error),
    });
    speech = recoverySpeech(dealershipContext);
    // Do not end call on transient AI errors — let caller retry
    endCall = false;
  }

  if (!speech) {
    speech = endCall
      ? lastFarewell || politeClose(dealershipContext)
      : recoverySpeech(dealershipContext);
  }

  // Soft strip raw UUIDs / ticket ids from spoken output
  speech = sanitizeSpeech(speech);

  await appendTranscriptSegment({
    callId: input.callId,
    speaker: 'agent',
    text: speech,
    agentName: activeAgent,
  });

  const metrics = endCall || dialHumanE164
    ? finalizeCallMetrics(state, {
        endCall: true,
        transferredHuman: transferredHuman || Boolean(dialHumanE164),
      })
    : state.metrics || emptyCallMetrics();

  // Promote slots into metrics for dashboards
  if (state.slots.callSummary) metrics.callSummary = state.slots.callSummary;
  if (state.slots.sentiment) metrics.sentiment = state.slots.sentiment;
  if (state.slots.primaryIntent) metrics.primaryIntent = state.slots.primaryIntent;
  metrics.agentDisplayName = dealershipContext.agentDisplayName || 'Sophia';
  state.metrics = metrics;

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
      status: endCall || dialHumanE164 ? 'completed' : 'in_progress',
      ...(endCall || dialHumanE164
        ? {
            endedAt: new Date(),
            contained: metrics.contained ?? null,
            outcome: metrics.outcome ?? null,
          }
        : {}),
      ...(rollup ? { transcriptEncrypted: rollup } : {}),
    },
  });

  return { speech, activeAgent, endCall: endCall || Boolean(dialHumanE164), state, dialHumanE164 };
}

function ensureMetricsAgentName(state: ConversationState, name: string): void {
  if (!state.metrics) state.metrics = emptyCallMetrics();
  state.metrics.agentDisplayName = name;
}

function recoverySpeech(ctx: DealershipContext): string {
  const agent = ctx.agentDisplayName || 'Sophia';
  return `I am ${agent} — I want to make sure I help you correctly. Could you please share that again in a few words?`;
}

function politeClose(ctx: DealershipContext): string {
  return `Thank you for calling ${ctx.dealershipName}. It was a pleasure assisting you. Goodbye.`;
}

function sanitizeSpeech(text: string): string {
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function buildEncryptedTranscriptRollup(callId: string): Promise<string | null> {
  const segments = await getRlsDb().voiceTranscriptSegment.findMany({
    where: { callId },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  if (segments.length === 0) return null;
  const text = segments
    .map((s) => {
      const body = decryptSensitiveText(s.textEncrypted || '');
      const who = s.speaker === 'agent' ? `agent:${s.agentName || 'sophia'}` : s.speaker;
      return `[${who}] ${body}`;
    })
    .join('\n');
  return encryptSensitiveText(text);
}

export async function buildOpeningGreeting(
  dealershipName: string,
  options?: { dealershipId?: string; toE164?: string | null; context?: DealershipContext }
): Promise<string> {
  const ctx =
    options?.context ||
    resolveDealershipContext({
      dealershipId: options?.dealershipId || '',
      dealershipName,
      toE164: options?.toE164,
    });
  return buildSophiaWelcome(ctx);
}

export function normalizeAgentName(value: string | null | undefined): VoiceAgentName {
  if (value && isVoiceAgentName(value)) return value;
  return 'receptionist';
}
