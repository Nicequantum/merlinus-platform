/**
 * PR-M5a/b — voice agent domain types.
 */

export type VoiceAgentName =
  | 'receptionist'
  | 'parts'
  | 'sales'
  | 'service'
  | 'loaner';

export const VOICE_AGENT_NAMES: readonly VoiceAgentName[] = [
  'receptionist',
  'parts',
  'sales',
  'service',
  'loaner',
] as const;

export type ConversationSlots = {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  vin?: string;
  vehicleLabel?: string;
  subject?: string;
  summary?: string;
  departmentRequestId?: string;
  loanerAssignmentId?: string;
  /** Brief for the next specialist after handoff */
  handoffBrief?: string;
  preferredDepartment?: string;
  /** Call-level summary for ops dashboards */
  callSummary?: string;
  /** neutral | positive | frustrated | urgent | confused */
  sentiment?: string;
  /** Intent tags, e.g. service_appointment, hours, parts */
  primaryIntent?: string;
};

export type HandoffEvent = {
  from: string;
  to: string;
  at: string;
  reason?: string;
  brief?: string;
};

/** Containment / quality counters accumulated during the call. */
export type CallMetrics = {
  toolSuccessCount: number;
  toolFailureCount: number;
  handoffCount: number;
  specialistTurns: number;
  receptionistTurns: number;
  /** True if a staff work item was created (parts/sales/service/loaner) */
  createdWorkItem: boolean;
  /** resolved_by_agent | staff_followup | transferred_human | abandoned | incomplete */
  outcome?: string;
  /** Agent resolved without needing human (heuristic) */
  contained?: boolean;
  /** Last known sentiment for the call */
  sentiment?: string;
  /** Short operator-facing summary */
  callSummary?: string;
  /** Primary intent label */
  primaryIntent?: string;
  /** Agent persona name (Sophia) */
  agentDisplayName?: string;
};

export type ConversationState = {
  slots: ConversationSlots;
  routingPath: string[];
  turnCount: number;
  lastToolResults?: string[];
  handoffs?: HandoffEvent[];
  metrics?: CallMetrics;
};

export type VoiceToolResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};

export type AgentTurnResult = {
  speech: string;
  activeAgent: VoiceAgentName;
  endCall: boolean;
  state: ConversationState;
};

export function emptyCallMetrics(): CallMetrics {
  return {
    toolSuccessCount: 0,
    toolFailureCount: 0,
    handoffCount: 0,
    specialistTurns: 0,
    receptionistTurns: 0,
    createdWorkItem: false,
  };
}

export function emptyConversationState(): ConversationState {
  return {
    slots: {},
    routingPath: ['receptionist'],
    turnCount: 0,
    handoffs: [],
    metrics: emptyCallMetrics(),
  };
}

export function isVoiceAgentName(value: string): value is VoiceAgentName {
  return (VOICE_AGENT_NAMES as readonly string[]).includes(value);
}
