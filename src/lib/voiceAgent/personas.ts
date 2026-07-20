import {
  resolveDealershipContext,
  type DealershipContext,
} from '@/lib/voiceAgent/dealershipContext';
import { buildSophiaSystemPrompt } from '@/lib/voiceAgent/sophiaPrompt';
import type { VoiceAgentName } from '@/lib/voiceAgent/types';

/**
 * Build the active agent system prompt.
 * Prefer resolveDealershipContext + Sophia when multi-tenant context is available.
 */
export function systemPromptForAgent(
  agent: VoiceAgentName,
  dealershipName: string,
  context?: DealershipContext
): string {
  const ctx =
    context ||
    resolveDealershipContext({
      dealershipId: '',
      dealershipName,
    });
  return buildSophiaSystemPrompt(agent, ctx);
}
