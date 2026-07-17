/**
 * PR-M5a — multi-turn agent loop (receptionist → parts/loaner).
 */

import 'server-only';

import { encryptSensitiveText } from '@/lib/encryption';
import { getRlsDb } from '@/lib/apex/rlsContext';
import { grokVoiceChat, type VoiceChatMessage } from '@/lib/voiceAgent/grokClient';
import { systemPromptForAgent } from '@/lib/voiceAgent/personas';
import { executeVoiceTool, VOICE_TOOL_DEFINITIONS } from '@/lib/voiceAgent/tools';
import type {
  AgentTurnResult,
  ConversationState,
  VoiceAgentName,
} from '@/lib/voiceAgent/types';

const MAX_TOOL_ROUNDS = 4;

export function parseConversationState(raw: string | null | undefined): ConversationState {
  try {
    const parsed = JSON.parse(raw || '{}') as ConversationState;
    return {
      slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : {},
      routingPath: Array.isArray(parsed.routingPath) ? parsed.routingPath : ['receptionist'],
      turnCount: typeof parsed.turnCount === 'number' ? parsed.turnCount : 0,
      lastToolResults: Array.isArray(parsed.lastToolResults) ? parsed.lastToolResults : [],
    };
  } catch {
    return { slots: {}, routingPath: ['receptionist'], turnCount: 0 };
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

export async function processAgentTurn(input: {
  dealershipId: string;
  dealershipName: string;
  callId: string;
  callerUtterance: string;
  activeAgent: VoiceAgentName;
  state: ConversationState;
}): Promise<AgentTurnResult> {
  let activeAgent = input.activeAgent;
  let state: ConversationState = {
    ...input.state,
    slots: { ...input.state.slots },
    routingPath: [...(input.state.routingPath || [])],
    turnCount: (input.state.turnCount || 0) + 1,
  };

  if (!state.routingPath.length) state.routingPath = ['receptionist'];

  await appendTranscriptSegment({
    callId: input.callId,
    speaker: 'caller',
    text: input.callerUtterance,
  });

  const messages: VoiceChatMessage[] = [
    {
      role: 'system',
      content: `${systemPromptForAgent(activeAgent, input.dealershipName)}

Current slots (JSON): ${JSON.stringify(state.slots)}
Routing path: ${state.routingPath.join(' → ')}
Turn: ${state.turnCount}`,
    },
    {
      role: 'user',
      content: input.callerUtterance.trim() || '(no speech detected)',
    },
  ];

  let endCall = false;
  let speech = '';
  let lastFarewell: string | undefined;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reply = await grokVoiceChat({
      messages,
      tools: VOICE_TOOL_DEFINITIONS,
      temperature: 0.35,
      maxTokens: 400,
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
      activeAgent = executed.activeAgent;
      if (executed.endCall) {
        endCall = true;
        lastFarewell = executed.farewell;
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(executed.result),
      });
    }

    // Agent may have changed — refresh system context on next round
    if (round < MAX_TOOL_ROUNDS - 1) {
      messages[0] = {
        role: 'system',
        content: `${systemPromptForAgent(activeAgent, input.dealershipName)}

Current slots (JSON): ${JSON.stringify(state.slots)}
Routing path: ${state.routingPath.join(' → ')}
Turn: ${state.turnCount}`,
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

  // Persist conversation + routing path on call
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
      status: endCall ? 'completed' : 'in_progress',
      ...(endCall ? { endedAt: new Date() } : {}),
    },
  });

  return { speech, activeAgent, endCall, state };
}

export async function buildOpeningGreeting(dealershipName: string): Promise<string> {
  return `Thank you for calling ${dealershipName}. This is the virtual receptionist. How can I help you today?`;
}
