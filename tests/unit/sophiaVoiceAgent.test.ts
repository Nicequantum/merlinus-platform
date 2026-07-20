import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STAGING_MERCEDES_BENZ_CONTEXT,
  buildSophiaWelcome,
  formatDealershipContextBlock,
  resolveDealershipContext,
} from '../../src/lib/voiceAgent/dealershipContext';
import { buildSophiaSystemPrompt } from '../../src/lib/voiceAgent/sophiaPrompt';
import { systemPromptForAgent } from '../../src/lib/voiceAgent/personas';
import { VOICE_TOOL_DEFINITIONS } from '../../src/lib/voiceAgent/tools';
import { emptyConversationState } from '../../src/lib/voiceAgent/types';
import { finalizeCallMetrics } from '../../src/lib/voiceAgent/metrics';

describe('Sophia receptionist voice agent', () => {
  test('staging context maps DID and welcome includes dealership + Sophia', () => {
    const ctx = resolveDealershipContext({
      dealershipId: 'seed-dealership',
      dealershipName: 'Mercedes-Benz Staging',
      toE164: '+14016454563',
    });
    assert.equal(ctx.dealershipName, 'Mercedes-Benz Staging');
    assert.equal(ctx.agentDisplayName, 'Sophia');
    assert.equal(ctx.mainPhoneE164, '+14016454563');
    const welcome = buildSophiaWelcome(ctx);
    assert.match(welcome, /Mercedes-Benz Staging/);
    assert.match(welcome, /Sophia/);
  });

  test('system prompt injects DEALERSHIP_CONTEXT block', () => {
    const prompt = buildSophiaSystemPrompt('receptionist', STAGING_MERCEDES_BENZ_CONTEXT);
    assert.match(prompt, /Sophia/);
    assert.match(prompt, /Mercedes-Benz Staging/);
    assert.match(prompt, /DEALERSHIP_CONTEXT|Dealership name:/i);
    assert.match(prompt, /hours/i);
    assert.match(prompt, /Never invent/i);
    const viaPersona = systemPromptForAgent('receptionist', 'Mercedes-Benz Staging', STAGING_MERCEDES_BENZ_CONTEXT);
    assert.match(viaPersona, /Sophia/);
  });

  test('format context is multi-tenant friendly', () => {
    const block = formatDealershipContextBlock(STAGING_MERCEDES_BENZ_CONTEXT);
    assert.match(block, /Main phone/);
    assert.match(block, /Service/);
  });

  test('tools include Sophia ops tools', () => {
    const names = VOICE_TOOL_DEFINITIONS.map((t) => t.function.name);
    assert.ok(names.includes('get_dealership_info'));
    assert.ok(names.includes('log_call_summary'));
    assert.ok(names.includes('set_call_sentiment'));
    assert.ok(names.includes('transfer_to_human'));
    assert.ok(names.includes('create_service_request'));
  });

  test('metrics can carry summary and sentiment', () => {
    const state = emptyConversationState();
    state.metrics = {
      toolSuccessCount: 1,
      toolFailureCount: 0,
      handoffCount: 0,
      specialistTurns: 0,
      receptionistTurns: 2,
      createdWorkItem: false,
      callSummary: 'Caller asked hours; resolved.',
      sentiment: 'positive',
    };
    const fin = finalizeCallMetrics(state, { endCall: true });
    assert.equal(fin.outcome, 'resolved_by_agent');
    assert.equal(fin.contained, true);
    assert.equal(state.metrics?.callSummary, 'Caller asked hours; resolved.');
  });
});
