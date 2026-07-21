/**
 * Extensible Voice Agent Registry — central nervous system for multi-agent phone AI.
 *
 * Add a new department agent:
 * 1. Register a VoiceAgentDefinition below (or via registerVoiceAgent at boot).
 * 2. Optionally map DID → agent in DealershipModule.configJson.voiceRouting.
 * 3. Add tool names the agent may use (optional allow-list).
 * 4. Wire keywords for receptionist intent routing.
 *
 * Runtime resolution order:
 *   explicit agent id → DID map → keyword intent → default receptionist (Sophia)
 */

import type { DealershipContext } from '@/lib/voiceAgent/dealershipContext';
import { buildSophiaSystemPrompt } from '@/lib/voiceAgent/sophiaPrompt';
import type { VoiceAgentName } from '@/lib/voiceAgent/types';

export type VoiceAgentId = VoiceAgentName | (string & {});

export type VoiceAgentDefinition = {
  /** Stable id stored on VoiceConversation.activeAgent */
  id: VoiceAgentId;
  /** Customer-facing or ops display name */
  displayName: string;
  /** Department bucket for analytics / tickets */
  department: 'reception' | 'service' | 'parts' | 'sales' | 'loaner' | 'finance' | 'other';
  /** Short description for docs / UI */
  description: string;
  /** Whether this is the default inbound agent for a rooftop */
  isDefaultInbound?: boolean;
  /** Keywords that suggest routing to this agent (lowercased match) */
  routeKeywords: string[];
  /** Optional tool-name allow list; empty = all tools */
  allowedTools?: string[];
  /** Build system prompt for this agent */
  buildSystemPrompt: (ctx: DealershipContext) => string;
};

const AGENTS = new Map<string, VoiceAgentDefinition>();

function define(def: VoiceAgentDefinition): VoiceAgentDefinition {
  AGENTS.set(def.id, def);
  return def;
}

/** Sophia — main receptionist (flagship) */
define({
  id: 'receptionist',
  displayName: 'Sophia',
  department: 'reception',
  description: 'Primary inbound receptionist — containment, FAQ, routing',
  isDefaultInbound: true,
  routeKeywords: ['hello', 'hours', 'open', 'direction', 'location', 'main', 'operator'],
  buildSystemPrompt: (ctx) => buildSophiaSystemPrompt('receptionist', ctx),
});

define({
  id: 'service',
  displayName: 'Service Specialist',
  department: 'service',
  description: 'Service appointments, maintenance, drivability concerns',
  routeKeywords: [
    'service',
    'appointment',
    'oil',
    'brake',
    'check engine',
    'repair',
    'maintenance',
    'warranty',
    'noise',
    'warning light',
  ],
  buildSystemPrompt: (ctx) => buildSophiaSystemPrompt('service', ctx),
});

define({
  id: 'parts',
  displayName: 'Parts Specialist',
  department: 'parts',
  description: 'Parts counter, orders, availability follow-up',
  routeKeywords: ['parts', 'part number', 'order part', 'counter', 'filter', 'pad'],
  buildSystemPrompt: (ctx) => buildSophiaSystemPrompt('parts', ctx),
});

define({
  id: 'sales',
  displayName: 'Sales Specialist',
  department: 'sales',
  description: 'New / CPO interest, trade-in, sales callbacks',
  routeKeywords: ['sales', 'buy', 'lease', 'inventory', 'trade', 'price', 'finance a car'],
  buildSystemPrompt: (ctx) => buildSophiaSystemPrompt('sales', ctx),
});

define({
  id: 'loaner',
  displayName: 'Loaner Specialist',
  department: 'loaner',
  description: 'Courtesy / loaner vehicle coordination',
  routeKeywords: ['loaner', 'courtesy', 'rental', 'shuttle car'],
  buildSystemPrompt: (ctx) => buildSophiaSystemPrompt('loaner', ctx),
});

/**
 * Future: Finance agent scaffold (registered but not yet on live DID map).
 * Extend buildSystemPrompt when product is ready — no runtime breakage.
 */
define({
  id: 'finance',
  displayName: 'Finance Specialist',
  department: 'finance',
  description: 'Payment / financing inquiry routing (future)',
  routeKeywords: ['finance', 'payment', 'lease payment', 'loan', 'payoff'],
  allowedTools: ['update_caller_info', 'create_sales_request', 'transfer_to_human', 'log_call_summary', 'end_call'],
  buildSystemPrompt: (ctx) =>
    `${buildSophiaSystemPrompt('sales', ctx)}

## Role: Finance specialist (beta)
You help with payment and financing questions only at a high level.
Never quote rates or approve credit. Capture the request and create a sales/finance follow-up.
Dealership: ${ctx.dealershipName}.`,
});

/** Runtime registration for plugins / future modules */
export function registerVoiceAgent(def: VoiceAgentDefinition): void {
  AGENTS.set(def.id, def);
}

export function getVoiceAgent(id: string | null | undefined): VoiceAgentDefinition | null {
  if (!id) return null;
  return AGENTS.get(id) || null;
}

export function listVoiceAgents(): VoiceAgentDefinition[] {
  return [...AGENTS.values()];
}

export function getDefaultInboundAgent(): VoiceAgentDefinition {
  return (
    [...AGENTS.values()].find((a) => a.isDefaultInbound) ||
    AGENTS.get('receptionist')!
  );
}

export type VoiceRoutingConfig = {
  /** E.164 → agent id */
  didMap?: Record<string, string>;
  /** Force default agent id for rooftop */
  defaultAgentId?: string;
};

/**
 * Resolve which agent should answer / continue based on DID + optional utterance.
 */
export function resolveInboundAgent(input: {
  toE164?: string | null;
  routing?: VoiceRoutingConfig | null;
  utterance?: string | null;
}): VoiceAgentDefinition {
  const did = (input.toE164 || '').replace(/\D/g, '');
  if (input.routing?.didMap) {
    for (const [key, agentId] of Object.entries(input.routing.didMap)) {
      if (did && key.replace(/\D/g, '').endsWith(did.slice(-10))) {
        const found = getVoiceAgent(agentId);
        if (found) return found;
      }
    }
  }
  if (input.routing?.defaultAgentId) {
    const found = getVoiceAgent(input.routing.defaultAgentId);
    if (found) return found;
  }
  if (input.utterance?.trim()) {
    const guessed = guessAgentFromUtterance(input.utterance);
    if (guessed && guessed.id !== 'receptionist') return guessed;
  }
  return getDefaultInboundAgent();
}

/** Keyword scoring for receptionist handoff suggestions */
export function guessAgentFromUtterance(utterance: string): VoiceAgentDefinition | null {
  const text = utterance.toLowerCase();
  let best: VoiceAgentDefinition | null = null;
  let bestScore = 0;
  for (const agent of AGENTS.values()) {
    if (agent.id === 'receptionist') continue;
    let score = 0;
    for (const kw of agent.routeKeywords) {
      if (text.includes(kw.toLowerCase())) score += kw.split(' ').length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = agent;
    }
  }
  return bestScore > 0 ? best : getDefaultInboundAgent();
}

/** Category tags for hub analytics / filters */
export function categorizeCall(input: {
  primaryIntent?: string | null;
  routingPath?: string[];
  outcome?: string | null;
  slots?: Record<string, unknown>;
}): string[] {
  const tags = new Set<string>();
  const intent = (input.primaryIntent || '').toLowerCase();
  if (intent) tags.add(intent.replace(/\s+/g, '_'));
  for (const step of input.routingPath || []) {
    const agent = getVoiceAgent(step);
    if (agent) tags.add(`dept:${agent.department}`);
    tags.add(`agent:${step}`);
  }
  if (input.outcome) tags.add(`outcome:${input.outcome}`);
  if (input.slots?.departmentRequestId) tags.add('created_ticket');
  if (input.slots?.loanerAssignmentId) tags.add('loaner_reserved');
  if (input.slots?.vehicleLabel || input.slots?.vin) tags.add('vehicle_linked');
  if (input.slots?.customerName || input.slots?.customerPhone) tags.add('customer_linked');
  return [...tags].slice(0, 24);
}

export function parseVoiceRoutingConfig(configJson?: string | null): VoiceRoutingConfig {
  if (!configJson?.trim()) return {};
  try {
    const parsed = JSON.parse(configJson) as { voiceRouting?: VoiceRoutingConfig };
    return parsed.voiceRouting && typeof parsed.voiceRouting === 'object'
      ? parsed.voiceRouting
      : {};
  } catch {
    return {};
  }
}
