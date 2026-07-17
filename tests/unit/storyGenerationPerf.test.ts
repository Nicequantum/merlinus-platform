import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { STORY_GENERATION_PHASES } from '../../src/hooks/useStoryGenerationPhase';
import {
  SYSTEM_PROMPT,
  WARRANTY_STORY_MAX_TOKENS,
  WARRANTY_STORY_TEMPERATURE,
  buildWarrantyStoryUserMessage,
} from '../../src/prompts/warrantyStory';
import { STORY_SCORE_SYSTEM_PROMPT } from '../../src/prompts/storyQuality';
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

describe('story generation performance settings', () => {
  test('uses non-reasoning story model and grok-4.3 for vision', () => {
    const grokSrc = readFileSync(join(process.cwd(), 'src/lib/grok.ts'), 'utf8');
    const modelsSrc = readFileSync(join(process.cwd(), 'src/lib/grokModels.ts'), 'utf8');
    assert.match(modelsSrc, /grok-4\.20-0309-non-reasoning/);
    assert.match(modelsSrc, /GROK_CHAT_MODEL = 'grok-4\.3'/);
    assert.match(grokSrc, /model: GROK_STORY_MODEL/);
    assert.match(grokSrc, /!model\.includes\('non-reasoning'\)/);
  });

  test('allows richer generation output and voice variation temperature', () => {
    assert.ok(WARRANTY_STORY_MAX_TOKENS >= 4096);
    assert.ok(WARRANTY_STORY_TEMPERATURE >= 0.35);
  });

  test('prompts include master-technician system rules and persona user message', () => {
    const userMessage = buildWarrantyStoryUserMessage(baseRo, baseLine);
    assert.match(SYSTEM_PROMPT, /3C|Concern|Cause|Correction/i);
    assert.match(SYSTEM_PROMPT, /Critical Quality Rules/i);
    assert.match(userMessage, /P0300/);
    assert.match(userMessage, /STYLE VARIATION/i);
    assert.match(userMessage, /10-step/i);
  });

  test('score system prompt uses compact MI criteria', () => {
    assert.match(STORY_SCORE_SYSTEM_PROMPT, /MI 2\.0 scoring/i);
    // Compact relative to full MI guidelines; room for truth-policy note
    assert.ok(STORY_SCORE_SYSTEM_PROMPT.length < 2_400);
  });

  test('generation phase messages cover story writing only', () => {
    assert.equal(STORY_GENERATION_PHASES.length, 3);
    assert.match(STORY_GENERATION_PHASES[0], /Thinking/i);
    assert.match(STORY_GENERATION_PHASES[2], /Polishing/i);
  });
});