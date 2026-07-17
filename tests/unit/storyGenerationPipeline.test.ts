import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import {
  auditStoryGenerationPipeline,
  resolveStoryReasoningEffort,
} from '../../src/lib/storyGenerationPipeline';
import type { RepairLine, RepairOrder } from '../../src/types';

const baseRo: RepairOrder = {
  id: 'ro-1',
  roNumber: '482910',
  vehicle: {
    vin: 'W1N4N4HB5NJ123456',
    year: '2022',
    make: 'Mercedes-Benz',
    model: 'GLE 350',
    mileageIn: '28450',
    mileageOut: '28458',
  },
  customer: { name: 'John Smith' },
  complaints: ['# A CHECK ENGINE LIGHT ON'],
  repairLines: [],
};

const baseLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON',
  technicianNotes: 'Found P0300. Source voltage 12.4V.',
  xentryImages: [],
  extractedData: {
    codes: ['P0300'],
    faultCodes: [{ code: 'P0300', description: 'Random/multiple cylinder misfire detected' }],
    guidedTests: ['Cylinder 3 misfire count elevated'],
    measurements: [{ label: 'Source voltage', value: '12.4V' }],
    components: [],
    circuits: [],
  },
};

describe('story generation pipeline audit', () => {
  test('uses non-reasoning grok-4.20 model by default', () => {
    const grokSrc = readFileSync(join(process.cwd(), 'src/lib/grokModels.ts'), 'utf8');
    assert.match(grokSrc, /GROK_STORY_MODEL/);
    assert.match(grokSrc, /grok-4\.20-0309-non-reasoning/);
    assert.match(grokSrc, /non-reasoning/);
  });

  test('resolveStoryReasoningEffort skips param for non-reasoning models', () => {
    assert.match(resolveStoryReasoningEffort('grok-4.20-0309-non-reasoning'), /not used/i);
    assert.equal(resolveStoryReasoningEffort('grok-4.3'), 'none');
  });

  test('audit reports veteran-voice prompts and no optional context bloat', () => {
    const audit = auditStoryGenerationPipeline(baseRo, baseLine);
    assert.ok(audit.systemPromptChars > 1_400);
    assert.ok(audit.userMessageChars > 400);
    assert.ok(audit.totalPromptChars < 6_000);
    assert.ok(audit.maxOutputTokens >= 4096);
    assert.ok(audit.excludedFromPrompt.includes('knowledgeBase'));
    assert.ok(audit.excludedFromPrompt.includes('historyContext'));
    assert.equal(audit.timeouts.grokMs, 45_000);
    assert.equal(audit.timeouts.routeMaxDurationS, 90);
    assert.equal(audit.timeouts.clientMs, 100_000);
  });
});