import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  categorizeCall,
  getDefaultInboundAgent,
  getVoiceAgent,
  guessAgentFromUtterance,
  listVoiceAgents,
  resolveInboundAgent,
} from '../../src/lib/voiceAgent/registry';

const root = resolve(process.cwd());

describe('Voice registry + hub integration', () => {
  test('registry lists core agents including Sophia receptionist', () => {
    const agents = listVoiceAgents();
    assert.ok(agents.some((a) => a.id === 'receptionist'));
    assert.ok(agents.some((a) => a.id === 'service'));
    assert.ok(agents.some((a) => a.id === 'finance'));
    const sophia = getDefaultInboundAgent();
    assert.equal(sophia.displayName, 'Sophia');
  });

  test('DID map and keyword routing resolve agents', () => {
    const byDid = resolveInboundAgent({
      toE164: '+14015550123',
      routing: { didMap: { '+14015550123': 'parts' } },
    });
    assert.equal(byDid.id, 'parts');

    const byKw = guessAgentFromUtterance('I need to book a service appointment for oil change');
    assert.equal(byKw?.id, 'service');
  });

  test('categorizeCall produces department and outcome tags', () => {
    const tags = categorizeCall({
      primaryIntent: 'service_appointment',
      routingPath: ['receptionist', 'service'],
      outcome: 'staff_followup',
      slots: { customerName: 'Alex', vehicleLabel: 'C300' },
    });
    assert.ok(tags.includes('service_appointment'));
    assert.ok(tags.some((t) => t.startsWith('dept:')));
    assert.ok(tags.includes('customer_linked'));
    assert.ok(tags.includes('vehicle_linked'));
  });

  test('hub ingest and analytics modules exist', () => {
    const ingest = readFileSync(resolve(root, 'src/lib/hub/callIngest.ts'), 'utf8');
    assert.match(ingest, /ingestCompletedCallToHub/);
    assert.match(ingest, /conversationInsight/);
    const analytics = readFileSync(resolve(root, 'src/lib/hub/analytics.ts'), 'utf8');
    assert.match(analytics, /conversionRate/);
    assert.match(analytics, /peakHours/);
  });

  test('call complete hooks into hub ingest', () => {
    const lifecycle = readFileSync(resolve(root, 'src/lib/voiceAgent/callLifecycle.ts'), 'utf8');
    assert.match(lifecycle, /ingestCompletedCallToHubSafe/);
    const runtime = readFileSync(resolve(root, 'src/lib/voiceAgent/runtime.ts'), 'utf8');
    assert.match(runtime, /ingestCompletedCallToHubSafe/);
  });

  test('one-click appointment and recording media routes exist', () => {
    const createAppt = readFileSync(
      resolve(root, 'src/app/api/hub/conversations/[callId]/create-appointment/route.ts'),
      'utf8'
    );
    assert.match(createAppt, /voice_suggestion/);
    const rec = readFileSync(
      resolve(root, 'src/app/api/voice/calls/[id]/recording/media/route.ts'),
      'utf8'
    );
    assert.match(rec, /voice-recording/);
  });

  test('getVoiceAgent unknown returns null', () => {
    assert.equal(getVoiceAgent('not_a_real_agent'), null);
  });
});
