/**
 * Lightweight intent classifier for department routing and escalation.
 * Keyword + score based — no extra model call on the hot path (phone + tablet).
 */
import {
  guessAgentFromUtterance,
  getVoiceAgent,
  type VoiceAgentDefinition,
} from '@/lib/voiceAgent/registry';
import type { VoiceAgentName } from '@/lib/voiceAgent/types';
import type { VoiceDepartmentId } from '@/lib/modules/catalog';

export type ClassifiedIntent = {
  department: VoiceDepartmentId | 'reception' | 'unknown';
  agentId: VoiceAgentName | 'receptionist';
  confidence: number;
  /** Escalation when human / manager needed */
  escalate: boolean;
  escalateReason?: string;
  labels: string[];
};

const ESCALATE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\b(manager|supervisor|human|real person|agent please)\b/i, reason: 'caller_requested_human' },
  { re: /\b(lawyer|attorney|lawsuit|complaint|bbb)\b/i, reason: 'legal_complaint' },
  { re: /\b(emergency|fire|ambulance|911)\b/i, reason: 'emergency' },
  { re: /\b(unsafe|danger|crash|accident on road)\b/i, reason: 'safety' },
];

const DEPT_LABELS: Record<string, string[]> = {
  service: ['service_appointment', 'repair', 'warranty', 'maintenance', 'mpi'],
  parts: ['parts_order', 'parts_lookup', 'counter'],
  sales: ['sales_lead', 'quote', 'inventory', 'trade_in'],
  loaner: ['loaner_reservation', 'courtesy_vehicle', 'return'],
  reception: ['hours', 'directions', 'general'],
};

/**
 * Classify utterance for routing. Prefer explicit department when provided (tablet UI).
 */
export function classifyVoiceIntent(input: {
  utterance: string;
  /** When user is already on a department screen */
  preferredDepartment?: VoiceDepartmentId | null;
  enabledDepartments?: VoiceDepartmentId[];
}): ClassifiedIntent {
  const text = (input.utterance || '').trim();
  const enabled = new Set(input.enabledDepartments || ['service', 'loaner', 'parts', 'sales']);

  for (const { re, reason } of ESCALATE_PATTERNS) {
    if (re.test(text)) {
      return {
        department: input.preferredDepartment || 'unknown',
        agentId: (input.preferredDepartment as VoiceAgentName) || 'receptionist',
        confidence: 0.95,
        escalate: true,
        escalateReason: reason,
        labels: ['escalate', reason],
      };
    }
  }

  if (input.preferredDepartment && enabled.has(input.preferredDepartment)) {
    return {
      department: input.preferredDepartment,
      agentId: input.preferredDepartment,
      confidence: text ? 0.75 : 0.9,
      escalate: false,
      labels: DEPT_LABELS[input.preferredDepartment] || [input.preferredDepartment],
    };
  }

  if (!text) {
    return {
      department: 'reception',
      agentId: 'receptionist',
      confidence: 0.4,
      escalate: false,
      labels: ['empty'],
    };
  }

  const guessed: VoiceAgentDefinition | null = guessAgentFromUtterance(text);
  let department: ClassifiedIntent['department'] = 'reception';
  let agentId: VoiceAgentName | 'receptionist' = 'receptionist';

  if (guessed) {
    if (guessed.department === 'service' || guessed.id === 'service') {
      department = 'service';
      agentId = 'service';
    } else if (guessed.department === 'parts' || guessed.id === 'parts') {
      department = 'parts';
      agentId = 'parts';
    } else if (guessed.department === 'sales' || guessed.id === 'sales') {
      department = 'sales';
      agentId = 'sales';
    } else if (guessed.department === 'loaner' || guessed.id === 'loaner') {
      department = 'loaner';
      agentId = 'loaner';
    }
  }

  if (department !== 'reception' && department !== 'unknown' && !enabled.has(department)) {
    return {
      department: 'reception',
      agentId: 'receptionist',
      confidence: 0.5,
      escalate: false,
      labels: ['department_disabled', department],
    };
  }

  const def = getVoiceAgent(agentId);
  const keywordHit = def?.routeKeywords.some((k) => text.toLowerCase().includes(k)) ?? false;

  return {
    department,
    agentId,
    confidence: keywordHit ? 0.82 : 0.55,
    escalate: false,
    labels: DEPT_LABELS[department] || [department],
  };
}

export function departmentToAgentId(department: VoiceDepartmentId): VoiceAgentName {
  return department;
}
