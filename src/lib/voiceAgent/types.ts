/**
 * PR-M5a — voice agent domain types.
 */

export type VoiceAgentName = 'receptionist' | 'parts' | 'loaner';

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
};

export type ConversationState = {
  slots: ConversationSlots;
  routingPath: string[];
  turnCount: number;
  lastToolResults?: string[];
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
