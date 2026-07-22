/**
 * Department-aware tablet / front-desk voice query engine.
 * Reuses Sophia personas + tools with conversation memory and SSE-friendly events.
 */
import 'server-only';

import { randomUUID } from 'crypto';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';
import type { VoiceDepartmentId } from '@/lib/modules/catalog';
import { isVoiceDepartmentEnabled } from '@/lib/modules/entitlements';
import {
  resolveDealershipContext,
  type DealershipContext,
} from '@/lib/voiceAgent/dealershipContext';
import { classifyVoiceIntent } from '@/lib/voiceAgent/intentClassifier';
import { grokVoiceChat, type VoiceChatMessage } from '@/lib/voiceAgent/grokClient';
import { systemPromptForAgent } from '@/lib/voiceAgent/personas';
import { executeVoiceTool, VOICE_TOOL_DEFINITIONS } from '@/lib/voiceAgent/tools';
import type { ConversationState, VoiceAgentName } from '@/lib/voiceAgent/types';
import {
  emptyConversationState,
  isVoiceAgentName,
} from '@/lib/voiceAgent/types';
import {
  ensureMetrics,
  recordTurnAgent,
  recordToolResult,
} from '@/lib/voiceAgent/metrics';
import {
  buildTailoringPromptBlock,
  getDepartmentCustomization,
  isTailoringDepartment,
  type TailoringDepartment,
} from '@/lib/voiceAgent/customization';

export type DepartmentQueryEvent =
  | {
      type: 'status';
      phase: 'listening' | 'thinking' | 'tool' | 'responding' | 'done' | 'error';
      message?: string;
    }
  | {
      type: 'intent';
      department: string;
      confidence: number;
      labels: string[];
      escalate?: boolean;
    }
  | { type: 'tailoring'; active: boolean; version: number }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string }
  | {
      type: 'result';
      speech: string;
      activeAgent: string;
      conversationId: string;
      slots: Record<string, unknown>;
      escalate?: boolean;
      escalateReason?: string;
      tailoringActive?: boolean;
    };

export type DepartmentQueryInput = {
  dealershipId: string;
  technicianId: string;
  department: VoiceDepartmentId;
  message: string;
  conversationId?: string | null;
  dealershipName?: string;
  handoffBrief?: string | null;
  /** Optional override for preview/test tailoring (manager UI) */
  managerName?: string | null;
  /** Inject draft tailoring without saving (preview mode) */
  previewTailoring?: {
    customInstructions?: string;
    greeting?: string;
    disclaimers?: string;
    toneGuidelines?: string;
  } | null;
};

const MAX_TOOL_ROUNDS = 5;

/** In-memory multi-turn state for tablet sessions (isolate-local; fine for short desk chats). */
const tabletSessions = new Map<
  string,
  { state: ConversationState; dealershipId: string; updatedAt: number }
>();

function redactForLog(text: string): string {
  return text
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[vin]')
    .slice(0, 200);
}

function loadSession(
  input: DepartmentQueryInput
): { conversationId: string; state: ConversationState } {
  if (input.conversationId?.trim()) {
    const existing = tabletSessions.get(input.conversationId.trim());
    if (existing && existing.dealershipId === input.dealershipId) {
      if (input.handoffBrief?.trim()) {
        existing.state.slots.handoffBrief = input.handoffBrief.trim();
      }
      existing.updatedAt = Date.now();
      return { conversationId: input.conversationId.trim(), state: existing.state };
    }
  }
  const id = randomUUID();
  const state = emptyConversationState();
  state.routingPath = [input.department];
  state.slots.preferredDepartment = input.department;
  if (input.handoffBrief?.trim()) {
    state.slots.handoffBrief = input.handoffBrief.trim();
  }
  tabletSessions.set(id, {
    state,
    dealershipId: input.dealershipId,
    updatedAt: Date.now(),
  });
  // Cap map size
  if (tabletSessions.size > 500) {
    const oldest = [...tabletSessions.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) tabletSessions.delete(oldest[0]);
  }
  return { conversationId: id, state };
}

async function persistAudit(input: {
  conversationId: string;
  dealershipId: string;
  technicianId: string;
  department: VoiceDepartmentId;
  userText: string;
  agentText: string;
  activeAgent: string;
  primaryIntent?: string;
}): Promise<void> {
  try {
    await withRlsBypass(async () => {
      await getRlsDb().hubAuditEvent.create({
        data: {
          dealershipId: input.dealershipId,
          entityType: 'conversation',
          entityId: input.conversationId,
          action: 'voice.department_query',
          technicianId: input.technicianId,
          metadataJson: JSON.stringify({
            department: input.department,
            activeAgent: input.activeAgent,
            userChars: input.userText.length,
            agentChars: input.agentText.length,
            intent: input.primaryIntent || null,
            // Never store full free-text PII in metadata
            userPreview: redactForLog(input.userText),
          }),
        },
      });
    });
  } catch (error) {
    logger.warn('voice.department_audit_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  logger.info('voice.department_query', {
    dealershipId: input.dealershipId,
    department: input.department,
    conversationId: input.conversationId,
    activeAgent: input.activeAgent,
  });
  try {
    const { publishVoiceActivityToCenter } = await import('@/lib/manager/controlCenterHub');
    publishVoiceActivityToCenter({
      dealershipId: input.dealershipId,
      department: input.department,
      preview: input.userText.slice(0, 60),
    });
  } catch {
    // non-fatal
  }
}

function toolsForAgent(agent: VoiceAgentName) {
  const allow: Record<VoiceAgentName, string[]> = {
    receptionist: VOICE_TOOL_DEFINITIONS.map((t) => t.function.name),
    loaner: [
      'update_caller_info',
      'list_available_loaners',
      'create_loaner_reservation',
      'create_service_request',
      'transfer_with_context',
      'route_to_service',
      'log_call_summary',
      'set_call_sentiment',
      'end_call',
      'get_dealership_info',
    ],
    service: [
      'update_caller_info',
      'create_service_request',
      'transfer_with_context',
      'route_to_loaner',
      'route_to_parts',
      'list_available_loaners',
      'log_call_summary',
      'set_call_sentiment',
      'end_call',
      'get_dealership_info',
    ],
    parts: [
      'update_caller_info',
      'lookup_parts_guidance',
      'create_parts_request',
      'transfer_with_context',
      'route_to_service',
      'route_to_sales',
      'log_call_summary',
      'end_call',
      'get_dealership_info',
    ],
    sales: [
      'update_caller_info',
      'note_sales_interest',
      'create_sales_request',
      'transfer_with_context',
      'route_to_service',
      'route_to_parts',
      'log_call_summary',
      'end_call',
      'get_dealership_info',
    ],
  };
  const names = new Set(allow[agent] || allow.service);
  return VOICE_TOOL_DEFINITIONS.filter((t) => names.has(t.function.name));
}

/**
 * Run a department query, yielding SSE-friendly events.
 */
export async function* runDepartmentQuery(
  input: DepartmentQueryInput
): AsyncGenerator<DepartmentQueryEvent> {
  const enabled = await isVoiceDepartmentEnabled(input.dealershipId, input.department);
  if (!enabled) {
    yield {
      type: 'status',
      phase: 'error',
      message: `Sophia ${input.department} is not enabled for this dealership.`,
    };
    return;
  }

  yield { type: 'status', phase: 'thinking', message: 'Understanding your request…' };

  const enabledDepts: VoiceDepartmentId[] = [];
  for (const d of ['service', 'loaner', 'parts', 'sales'] as VoiceDepartmentId[]) {
    if (await isVoiceDepartmentEnabled(input.dealershipId, d)) enabledDepts.push(d);
  }

  const intent = classifyVoiceIntent({
    utterance: input.message,
    preferredDepartment: input.department,
    enabledDepartments: enabledDepts,
  });

  yield {
    type: 'intent',
    department: String(intent.department),
    confidence: intent.confidence,
    labels: intent.labels,
    escalate: intent.escalate,
  };

  if (intent.escalate) {
    const speech =
      intent.escalateReason === 'emergency'
        ? 'If this is an emergency, please call emergency services first. I can also have a manager call you right away — what is the best number?'
        : 'I will have a team member assist you. May I confirm the best callback number?';
    yield { type: 'status', phase: 'responding' };
    yield { type: 'delta', text: speech };
    yield {
      type: 'result',
      speech,
      activeAgent: input.department,
      conversationId: input.conversationId || randomUUID(),
      slots: { primaryIntent: intent.labels[0] },
      escalate: true,
      escalateReason: intent.escalateReason,
    };
    yield { type: 'status', phase: 'done' };
    return;
  }

  const { conversationId, state } = loadSession(input);
  state.turnCount = (state.turnCount || 0) + 1;
  state.slots.primaryIntent = intent.labels[0] || input.department;
  ensureMetrics(state);

  let activeAgent: VoiceAgentName = input.department;
  if (isVoiceAgentName(intent.agentId) && intent.agentId !== 'receptionist') {
    activeAgent = intent.agentId;
  }
  recordTurnAgent(state, activeAgent);

  const dealershipName = input.dealershipName?.trim() || 'Dealership';
  let ctx: DealershipContext = resolveDealershipContext({
    dealershipId: input.dealershipId,
    dealershipName,
  });

  const handoff = state.slots.handoffBrief
    ? `\nHandoff context: ${state.slots.handoffBrief}`
    : '';

  // Personal Tailoring — dealership-authored instructions (or preview draft)
  let tailoringBlock = '';
  let tailoringActive = false;
  let tailoringVersion = 0;
  const tailoringDept: TailoringDepartment = isTailoringDepartment(input.department)
    ? input.department
    : 'service';
  try {
    const saved = await getDepartmentCustomization(input.dealershipId, tailoringDept);
    const merged = input.previewTailoring
      ? {
          ...saved,
          customInstructions:
            input.previewTailoring.customInstructions ?? saved.customInstructions,
          greeting: input.previewTailoring.greeting ?? saved.greeting,
          disclaimers: input.previewTailoring.disclaimers ?? saved.disclaimers,
          toneGuidelines: input.previewTailoring.toneGuidelines ?? saved.toneGuidelines,
          isCustomized: Boolean(
            (input.previewTailoring.customInstructions ?? saved.customInstructions).trim() ||
              (input.previewTailoring.greeting ?? saved.greeting).trim() ||
              (input.previewTailoring.disclaimers ?? saved.disclaimers).trim() ||
              (input.previewTailoring.toneGuidelines ?? saved.toneGuidelines).trim()
          ),
        }
      : saved;
    tailoringVersion = merged.version;
    if (merged.isCustomized) {
      tailoringActive = true;
      tailoringBlock =
        '\n' +
        buildTailoringPromptBlock(merged, {
          dealershipName,
          managerName: input.managerName || undefined,
          brand: ctx.brand || 'Mercedes-Benz',
          departmentLabel: input.department,
        });
    }
  } catch {
    // non-fatal — core persona still works
  }
  yield { type: 'tailoring', active: tailoringActive, version: tailoringVersion };

  const system = `${systemPromptForAgent(activeAgent, dealershipName, ctx)}
${tailoringBlock}

## Tablet / front-desk channel
You are assisting staff or a customer via the dealership tablet app.
Be concise, accurate, and action-oriented.
Prefer tools: loaner availability, parts guidance/tickets, sales interest tickets, service follow-ups.
Never invent inventory, prices, warranty approvals, or loaner unit numbers.
Current department screen: ${input.department}.
Slots: ${JSON.stringify(state.slots)}
${handoff}`;

  const messages: VoiceChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: input.message.trim() },
  ];

  const tools = toolsForAgent(activeAgent);
  let speech = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      yield {
        type: 'status',
        phase: round === 0 ? 'thinking' : 'tool',
        message: round === 0 ? 'Sophia is thinking…' : 'Checking dealership systems…',
      };

      const result = await grokVoiceChat({
        messages,
        tools,
        temperature: 0.35,
        maxTokens: 600,
        timeoutMs: 40_000,
      });

      if (result.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.toolCalls,
        });
        for (const tc of result.toolCalls) {
          const out = await executeVoiceTool(tc.function.name, tc.function.arguments || '{}', {
            dealershipId: input.dealershipId,
            callId: conversationId,
            state,
            activeAgent,
            dealershipContext: ctx,
          });
          // Mutate shared state
          Object.assign(state, out.state);
          state.slots = out.state.slots;
          activeAgent = out.activeAgent;
          recordToolResult(state, out.result.ok);
          yield {
            type: 'tool',
            name: tc.function.name,
            ok: out.result.ok,
            summary: out.result.message.slice(0, 160),
          };
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: out.result.ok,
              message: out.result.message,
              data: out.result.data || null,
            }),
          });
        }
        continue;
      }

      speech = result.content || 'I can help with that — could you share a bit more detail?';
      break;
    }
  } catch (error) {
    logger.warn('voice.department_query_failed', {
      department: input.department,
      error: error instanceof Error ? error.message : String(error),
    });
    yield {
      type: 'status',
      phase: 'error',
      message: 'Sophia is temporarily unavailable. Try again in a moment.',
    };
    return;
  }

  if (!speech) {
    speech =
      'I created a note for the team where possible. Is there anything else I can help with?';
  }

  yield { type: 'status', phase: 'responding' };
  const chunkSize = 48;
  for (let i = 0; i < speech.length; i += chunkSize) {
    yield { type: 'delta', text: speech.slice(i, i + chunkSize) };
  }

  tabletSessions.set(conversationId, {
    state,
    dealershipId: input.dealershipId,
    updatedAt: Date.now(),
  });

  await persistAudit({
    conversationId,
    dealershipId: input.dealershipId,
    technicianId: input.technicianId,
    department: input.department,
    userText: input.message,
    agentText: speech,
    activeAgent,
    primaryIntent: state.slots.primaryIntent,
  });

  yield {
    type: 'result',
    speech,
    activeAgent,
    conversationId,
    slots: state.slots as Record<string, unknown>,
    tailoringActive,
  };
  yield { type: 'status', phase: 'done' };
}

export async function runDepartmentQueryOnce(
  input: DepartmentQueryInput
): Promise<{
  speech: string;
  conversationId: string;
  activeAgent: string;
  slots: Record<string, unknown>;
  escalate?: boolean;
}> {
  let speech = '';
  let conversationId = input.conversationId || '';
  let activeAgent = input.department;
  let slots: Record<string, unknown> = {};
  let escalate: boolean | undefined;
  for await (const ev of runDepartmentQuery(input)) {
    if (ev.type === 'delta') speech += ev.text;
    if (ev.type === 'result') {
      speech = ev.speech;
      conversationId = ev.conversationId;
      activeAgent = ev.activeAgent;
      slots = ev.slots;
      escalate = ev.escalate;
    }
    if (ev.type === 'status' && ev.phase === 'error') {
      throw new Error(ev.message || 'Voice query failed');
    }
  }
  return { speech, conversationId, activeAgent, slots, escalate };
}
