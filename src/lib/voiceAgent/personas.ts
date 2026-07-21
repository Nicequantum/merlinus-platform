import {
  resolveDealershipContext,
  type DealershipContext,
} from '@/lib/voiceAgent/dealershipContext';
import { getVoiceAgent, getDefaultInboundAgent } from '@/lib/voiceAgent/registry';
import { buildSophiaSystemPrompt } from '@/lib/voiceAgent/sophiaPrompt';
import type { VoiceAgentName } from '@/lib/voiceAgent/types';

/**
 * Build the active agent system prompt via the Voice Agent Registry.
 * Falls back to Sophia receptionist pack for unknown ids.
 */
export function systemPromptForAgent(
  agent: VoiceAgentName | string,
  dealershipName: string,
  context?: DealershipContext
): string {
  const ctx =
    context ||
    resolveDealershipContext({
      dealershipId: '',
      dealershipName,
    });
  const def = getVoiceAgent(agent) || getDefaultInboundAgent();
  try {
    return def.buildSystemPrompt(ctx);
  } catch {
    return buildSophiaSystemPrompt('receptionist', ctx);
  }
}
