import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  aggregateFromCallRows,
  finalizeCallMetrics,
  recordHandoff,
  recordWorkItem,
} from '../../src/lib/voiceAgent/metrics';
import { parseConversationState } from '../../src/lib/voiceAgent/runtime';
import { systemPromptForAgent } from '../../src/lib/voiceAgent/personas';
import { emptyConversationState, isVoiceAgentName } from '../../src/lib/voiceAgent/types';

describe('PR-M5b multi-agent voice expansion', () => {
  test('agent names include sales and service', () => {
    assert.equal(isVoiceAgentName('sales'), true);
    assert.equal(isVoiceAgentName('service'), true);
    assert.equal(isVoiceAgentName('wizard'), false);
    assert.match(systemPromptForAgent('sales', 'Test MB'), /SALES/i);
    assert.match(systemPromptForAgent('service', 'Test MB'), /SERVICE/i);
    assert.match(systemPromptForAgent('receptionist', 'Test MB'), /receptionist|Sophia|containment/i);
  });

  test('handoffs and containment metrics finalize', () => {
    const state = emptyConversationState();
    recordHandoff(state);
    recordHandoff(state);
    recordWorkItem(state);
    const metrics = finalizeCallMetrics(state, { endCall: true });
    assert.equal(metrics.handoffCount, 2);
    assert.equal(metrics.createdWorkItem, true);
    assert.equal(metrics.contained, true);
    assert.equal(metrics.outcome, 'staff_followup');
  });

  test('aggregate containment rate', () => {
    const agg = aggregateFromCallRows([
      {
        status: 'completed',
        contained: true,
        outcome: 'staff_followup',
        metricsJson: JSON.stringify({ handoffCount: 1, receptionistTurns: 2, specialistTurns: 1, createdWorkItem: true }),
        routingPathJson: JSON.stringify(['receptionist', 'parts']),
      },
      {
        status: 'completed',
        contained: false,
        outcome: 'transferred_human',
        metricsJson: JSON.stringify({ handoffCount: 0, receptionistTurns: 1, specialistTurns: 0, createdWorkItem: false }),
        routingPathJson: JSON.stringify(['receptionist']),
      },
    ]);
    assert.equal(agg.totalCalls, 2);
    assert.equal(agg.containedCalls, 1);
    assert.equal(agg.containmentRate, 0.5);
  });

  test('conversation state parses handoffs', () => {
    const s = parseConversationState(
      JSON.stringify({
        slots: { handoffBrief: 'needs brake pads' },
        routingPath: ['receptionist', 'parts'],
        turnCount: 3,
        handoffs: [{ from: 'receptionist', to: 'parts', at: '2026-01-01T00:00:00.000Z' }],
      })
    );
    assert.equal(s.slots.handoffBrief, 'needs brake pads');
    assert.equal(s.handoffs?.length, 1);
  });

  test('tools include sales/service routes and transfer_with_context', () => {
    const tools = readFileSync(resolve(process.cwd(), 'src/lib/voiceAgent/tools.ts'), 'utf8');
    assert.ok(tools.includes('route_to_sales'));
    assert.ok(tools.includes('route_to_service'));
    assert.ok(tools.includes('create_sales_request'));
    assert.ok(tools.includes('create_service_request'));
    assert.ok(tools.includes('transfer_with_context'));
  });

  test('recording + metrics migration and public route', () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20250728120000_voice_agent_metrics_recording/migration.sql'
      ),
      'utf8'
    );
    assert.ok(sql.includes('metricsJson'));
    assert.ok(sql.includes('recordingStatus'));
    assert.ok(sql.includes('contained'));

    const pub = readFileSync(resolve(process.cwd(), 'src/lib/publicRoutes.ts'), 'utf8');
    assert.ok(pub.includes('/api/voice/recording'));

    const rec = readFileSync(resolve(process.cwd(), 'src/app/api/voice/recording/route.ts'), 'utf8');
    assert.ok(rec.includes('storeTwilioRecording'));
  });

  test('manager APIs and ops UI', () => {
    assert.ok(
      readFileSync(resolve(process.cwd(), 'src/app/api/voice/calls/[id]/route.ts'), 'utf8').includes(
        "requireModule: 'voice_agent'"
      )
    );
    assert.ok(
      readFileSync(resolve(process.cwd(), 'src/app/api/voice/metrics/route.ts'), 'utf8').includes(
        'aggregateFromCallRows'
      )
    );
    assert.ok(
      readFileSync(resolve(process.cwd(), 'src/components/voice/VoiceOpsDashboard.tsx'), 'utf8').includes(
        'containment'
      )
    );
  });
});
