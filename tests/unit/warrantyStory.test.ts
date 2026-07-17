import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STORY_TEMPLATES,
  SYSTEM_PROMPT,
  THREE_C_GENERATION_RULES,
  VETERAN_TECH_PERSONAS,
  WARRANTY_STORY_MAX_TOKENS,
  WARRANTY_WORKFLOW_STEPS,
  WARRANTY_WORKFLOW_SUMMARY,
  buildWarrantyStoryUserMessage,
  selectVeteranPersona,
} from '../../src/prompts/warrantyStory';
import { PROMPT_VERSION } from '../../src/prompts/version';
import {
  GENERIC_FORBIDDEN_TERMS,
  GENERIC_STORY_PACK,
  MERCEDES_STORY_PACK,
  resolveStoryBrandPack,
  STRICT_TRUTH_RULES,
} from '../../src/prompts/story';
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
  complaints: ['# A CHECK ENGINE LIGHT ON — ADVISOR INACCURATE'],
  repairLines: [],
};

const baseLine: RepairLine = {
  id: 'line-1',
  lineNumber: 1,
  description: 'Engine diagnosis',
  customerConcern: 'CHECK ENGINE LIGHT ON — SHOULD NOT APPEAR IN PROMPT',
  technicianNotes: 'Found P0300. Source voltage 12.4V. Performed guided test on cylinder 3.',
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

describe('warranty story prompts', () => {
  test(`SYSTEM_PROMPT enforces master-technician 3C quality at v${PROMPT_VERSION}`, () => {
    assert.match(SYSTEM_PROMPT, /Merlin/i);
    assert.match(SYSTEM_PROMPT, new RegExp(`v${PROMPT_VERSION.replace(/\./g, '\\.')}`));
    assert.match(SYSTEM_PROMPT, /3C|Concern|Cause|Correction/i);
    assert.match(SYSTEM_PROMPT, /Quick Test/i);
    assert.match(SYSTEM_PROMPT, /Critical Quality Rules/i);
    assert.match(SYSTEM_PROMPT, /STRICT TRUTH RULES/i);
    assert.match(THREE_C_GENERATION_RULES, /Master Technician/i);
    assert.match(THREE_C_GENERATION_RULES, /\[NOT DOCUMENTED\]/);
    assert.match(THREE_C_GENERATION_RULES, /Never invent codes/i);
    assert.ok(SYSTEM_PROMPT.length > 1_200);
  });

  test('VETERAN_TECH_PERSONAS provides six distinct master-technician voices', () => {
    assert.equal(VETERAN_TECH_PERSONAS.length, 6);
    const voices = new Set(VETERAN_TECH_PERSONAS.map((p) => p.voice));
    assert.equal(voices.size, 6);
    for (const persona of VETERAN_TECH_PERSONAS) {
      assert.ok(persona.years >= 15 && persona.years <= 30);
    }
  });

  test('selectVeteranPersona rotates by line number', () => {
    assert.equal(selectVeteranPersona(1).id, VETERAN_TECH_PERSONAS[0]!.id);
    assert.equal(selectVeteranPersona(7).id, VETERAN_TECH_PERSONAS[0]!.id);
    assert.notEqual(selectVeteranPersona(1).id, selectVeteranPersona(2).id);
  });

  test('WARRANTY_WORKFLOW_STEPS lists all 10 billing/audit steps in order', () => {
    assert.equal(WARRANTY_WORKFLOW_STEPS.length, 10);
    assert.match(WARRANTY_WORKFLOW_STEPS[0], /Initial test drive/i);
    assert.match(WARRANTY_WORKFLOW_STEPS[9], /Final verification test drive/i);
    assert.match(WARRANTY_WORKFLOW_SUMMARY, /verification drive/i);
  });

  test('STORY_TEMPLATES reference diagnostic workflow elements', () => {
    assert.ok(STORY_TEMPLATES.length >= 5);
    for (const template of STORY_TEMPLATES) {
      assert.match(template, /workflow|drive|Quick Test|voltage|XENTRY|guided test|verification|complaint|findings/i);
    }
  });

  test('buildWarrantyStoryUserMessage includes persona, notes, diagnostics; omits customer complaint', () => {
    const message = buildWarrantyStoryUserMessage(baseRo, baseLine, { mode: 'generate' });
    assert.match(message, /Line 1/i);
    assert.match(message, /28450→28458/);
    assert.match(message, /P0300/);
    assert.match(message, /STYLE VARIATION/i);
    assert.match(message, /persona/i);
    assert.match(message, /10-step/i);
    assert.match(message, /never copy verbatim/i);
    assert.match(message, /<<<TECHNICIAN_NOTES>>/);
    assert.match(message, /TRUTH POLICY/i);
    assert.doesNotMatch(message, /RO_COMPLAINTS/);
    assert.doesNotMatch(message, /Complaint for this line/i);
    assert.doesNotMatch(message, /SHOULD NOT APPEAR IN PROMPT/);
    assert.doesNotMatch(message, /ADVISOR INACCURATE/);
    assert.doesNotMatch(message, /PRIOR_WARRANTY_STORY/);
  });

  test('regenerate pass is conservative edit of current story with required corrections', () => {
    const lineWithStory = {
      ...baseLine,
      warrantyStory:
        'Road tested the vehicle and confirmed misfire. Connected XENTRY. Found P0300. [NOT DOCUMENTED] for source voltage.',
      technicianNotes:
        'Found P0300. Source voltage 12.4V.\n[Audit enhancement] [Diagnostic] Guided test result for cylinder 3 elevated.\n===PENDING_AUDIT_CORRECTIONS===\n1. Source voltage 12.4V\n===END_PENDING_AUDIT_CORRECTIONS===',
    };
    const message = buildWarrantyStoryUserMessage(baseRo, lineWithStory, { mode: 'auto' });
    assert.match(message, /EDITING PASS|CURRENT_STORY_TO_EDIT/i);
    assert.match(message, /Road tested the vehicle/);
    assert.match(message, /REQUIRED_CORRECTIONS/);
    assert.match(message, /12\.4V|Guided test/i);
    assert.match(message, /base document|Keep every|REQUIRED_CORRECTION/i);
    assert.doesNotMatch(message, /Produce a complete, new 3C narrative from scratch/i);
    assert.match(message, /Never rewrite from scratch/i);
    assert.match(message, /TECHNICIAN_NOTES/);
    assert.doesNotMatch(message, /RO_COMPLAINTS/);
  });

  test('WARRANTY_STORY_MAX_TOKENS allows full workflow narratives', () => {
    assert.ok(WARRANTY_STORY_MAX_TOKENS >= 4096);
  });
});

describe('multi-brand story packs', () => {
  test('strict truth rules ban inventing and customer complaint as evidence', () => {
    assert.match(STRICT_TRUTH_RULES, /Never invent/i);
    assert.match(STRICT_TRUTH_RULES, /Customer Complaint/i);
    assert.match(STRICT_TRUTH_RULES, /OUT OF SCOPE/i);
  });

  test('mercedes pack retains XENTRY Quick Test workflow', () => {
    const pack = MERCEDES_STORY_PACK;
    assert.equal(pack.id, 'mercedes');
    assert.match(pack.systemPrompt, /XENTRY/i);
    assert.match(pack.systemPrompt, /Quick Test/i);
    assert.equal(pack.workflowSteps.length, 10);
    assert.match(pack.diagnosticsSourceLabel, /Xentry/i);
  });

  test('generic pack has no Mercedes-only product language', () => {
    const pack = GENERIC_STORY_PACK;
    assert.equal(pack.id, 'generic');
    const authored = [
      pack.systemPrompt,
      pack.workflowSteps.join('\n'),
      pack.workflowSummary,
      pack.personas.map((p) => p.voice).join('\n'),
      pack.quality.scoreSystemPrompt,
      pack.quality.scoreRetrySystemPrompt,
      pack.quality.reviewSystemPrompt,
    ].join('\n');
    for (const term of GENERIC_FORBIDDEN_TERMS) {
      assert.equal(
        authored.includes(term),
        false,
        `generic pack must not contain forbidden term: ${term}`
      );
    }
    assert.match(pack.systemPrompt, /diagnostic equipment/i);
    assert.match(pack.systemPrompt, /system scan/i);
    assert.match(pack.systemPrompt, /battery maintainer/i);
  });

  test('resolveStoryBrandPack defaults mercedes and fails safe to generic for unknown', () => {
    assert.equal(resolveStoryBrandPack(null).id, 'mercedes');
    assert.equal(resolveStoryBrandPack('mercedes').id, 'mercedes');
    assert.equal(resolveStoryBrandPack('generic').id, 'generic');
    assert.equal(resolveStoryBrandPack('bmw-future').id, 'generic');
  });

  test('generic user message uses diagnostic photos label', () => {
    const message = buildWarrantyStoryUserMessage(baseRo, baseLine, { brand: 'generic' });
    assert.match(message, /diagnostic photos/i);
    assert.doesNotMatch(message, /Xentry photos/i);
    assert.doesNotMatch(message, /RO_COMPLAINTS/);
  });
});
