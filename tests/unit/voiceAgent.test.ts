import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { parseConversationState } from '../../src/lib/voiceAgent/runtime';
import { escapeXml, twimlGather, twimlSayHangup } from '../../src/lib/voiceAgent/twilio';
import { systemPromptForAgent } from '../../src/lib/voiceAgent/personas';

describe('PR-M5a voice agent', () => {
  test('conversation state parse defaults', () => {
    const empty = parseConversationState('');
    assert.deepEqual(empty.slots, {});
    assert.ok(empty.routingPath.includes('receptionist'));
    const filled = parseConversationState(
      JSON.stringify({ slots: { subject: 'brake pads' }, routingPath: ['receptionist', 'parts'], turnCount: 2 })
    );
    assert.equal(filled.slots.subject, 'brake pads');
    assert.equal(filled.turnCount, 2);
  });

  test('TwiML helpers escape content', () => {
    assert.ok(escapeXml('a < b').includes('&lt;'));
    const gather = twimlGather({
      actionUrl: 'https://example.com/api/voice/gather?callId=1',
      say: 'Hello & welcome',
    });
    assert.ok(gather.includes('<Gather'));
    assert.ok(gather.includes('Hello &amp; welcome'));
    assert.ok(twimlSayHangup('Bye').includes('<Hangup/>'));
  });

  test('personas cover receptionist and parts', () => {
    assert.match(systemPromptForAgent('receptionist', 'Test MB'), /RECEPTIONIST/i);
    assert.match(systemPromptForAgent('parts', 'Test MB'), /PARTS/i);
    assert.match(systemPromptForAgent('loaner', 'Test MB'), /LOANER/i);
  });

  test('schema and migration for voice tables', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    assert.ok(schema.includes('model VoiceAgentLine'));
    assert.ok(schema.includes('model VoiceCall'));
    assert.ok(schema.includes('model VoiceConversation'));
    assert.ok(schema.includes('model VoiceTranscriptSegment'));

    const sql = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20250727120000_voice_agent/migration.sql'),
      'utf8'
    );
    assert.ok(sql.includes('VoiceAgentLine'));
    assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
    assert.ok(!sql.includes('ALTER TABLE "RepairOrder"'));
    assert.ok(!sql.includes('ALTER TABLE "RepairLine"'));
  });

  test('tools bind dealership and create parts / loaner helpers', () => {
    const tools = readFileSync(resolve(process.cwd(), 'src/lib/voiceAgent/tools.ts'), 'utf8');
    assert.ok(tools.includes('create_parts_request'));
    assert.ok(tools.includes('list_available_loaners'));
    assert.ok(tools.includes('create_loaner_reservation'));
    assert.ok(tools.includes('dealershipId: ctx.dealershipId'));
    assert.ok(tools.includes("department: 'parts'"));
    assert.ok(tools.includes("source: 'voice_agent'"));
  });

  test('public voice webhook routes and module gate on ops APIs', () => {
    const pub = readFileSync(resolve(process.cwd(), 'src/lib/publicRoutes.ts'), 'utf8');
    assert.ok(pub.includes('/api/voice/inbound'));
    assert.ok(pub.includes('/api/voice/gather'));
    assert.ok(pub.includes('/api/voice/status'));

    for (const file of [
      'src/app/api/voice/lines/route.ts',
      'src/app/api/voice/calls/route.ts',
    ]) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      assert.ok(src.includes("requireModule: 'voice_agent'"), file);
    }
  });
});
