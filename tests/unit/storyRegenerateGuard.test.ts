import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyCorrectionsToStoryDeterministically,
  ensureStoryPreservesPriorAndCorrections,
  extractRequiredCorrectionsFromNotes,
  extractTechnicalTokens,
  formatPendingCorrectionsBlock,
  mergePendingCorrectionsIntoNotes,
  storyContainsCorrection,
} from '../../src/lib/storyRegenerateGuard';
import { buildWarrantyStoryUserMessage } from '../../src/prompts/warrantyStory';
import type { RepairLine, RepairOrder } from '../../src/types';

describe('story regenerate guard', () => {
  test('extracts control-unit and voltage tokens', () => {
    const tokens = extractTechnicalTokens('Checked N73/1 and source voltage 12.4V with P0300.');
    assert.ok(tokens.some((t) => /N73\/1/i.test(t)));
    assert.ok(tokens.some((t) => /12\.4\s*V/i.test(t)));
    assert.ok(tokens.some((t) => /P0300/i.test(t)));
  });

  test('detects missing corrections and re-applies them', () => {
    const prior =
      'Road tested and confirmed rough idle. Connected XENTRY. Found P0300. Source voltage 12.4V. Completed repair.';
    // Model dropped voltage and ignored correction about N73/1 dash
    const regenerated = 'Road tested and confirmed rough idle. Found P0300. Completed repair.';
    const fixed = ensureStoryPreservesPriorAndCorrections(prior, regenerated, [
      'Control unit designation N73/1 with correct dash formatting.',
    ]);
    assert.match(fixed, /12\.4\s*V|12\.4V/i);
    assert.match(fixed, /N73\/1/i);
    assert.match(fixed, /P0300/);
  });

  test('prefers prior when regenerated is catastrophically shorter', () => {
    const prior = 'A'.repeat(400) + ' P0300 and 12.6V documented.';
    const regen = 'Short new story.';
    const fixed = ensureStoryPreservesPriorAndCorrections(prior, regen, []);
    assert.ok(fixed.length >= prior.length * 0.9);
    assert.match(fixed, /P0300/);
  });

  test('extracts pending corrections fence from notes', () => {
    const notes = `Found P0300.

===PENDING_AUDIT_CORRECTIONS===
1. Source voltage 12.4V at battery
2. N73/1 control unit designation
===END_PENDING_AUDIT_CORRECTIONS===
`;
    const list = extractRequiredCorrectionsFromNotes(notes);
    assert.equal(list.length, 2);
    assert.match(list[0]!, /12\.4/);
    assert.match(list[1]!, /N73/);
  });

  test('mergePendingCorrectionsIntoNotes replaces fence idempotently', () => {
    const first = mergePendingCorrectionsIntoNotes('Base notes', [
      { missing: 'Voltage', prompt: '12.4V', field: 'technicianNotes' },
    ]);
    assert.match(first, /===PENDING_AUDIT_CORRECTIONS===/);
    const second = mergePendingCorrectionsIntoNotes(first, [
      { missing: 'Voltage', prompt: '12.4V', field: 'technicianNotes' },
      { missing: 'N73', prompt: 'N73/1', field: 'diagnostic' },
    ]);
    assert.equal(second.split('===PENDING_AUDIT_CORRECTIONS===').length - 1, 1);
    assert.match(second, /N73\/1/);
  });

  test('insertCorrectionIntoStory places content before verification and preserves prior', () => {
    const prior =
      'Road tested and confirmed rough idle. Connected scan tool. Found P0300. Completed final verification drive.';
    const out = applyCorrectionsToStoryDeterministically(prior, [
      'Source voltage measured 12.4V at the battery.',
      'Control unit N73/1 designation confirmed.',
    ]);
    assert.match(out, /P0300/);
    assert.match(out, /12\.4\s*V|12\.4V/i);
    assert.match(out, /N73\/1/);
    assert.match(out, /final verification/i);
    assert.ok(out.indexOf('12.4') < out.toLowerCase().indexOf('final verification'));
  });

  test('storyContainsCorrection matches distinctive tokens', () => {
    assert.equal(storyContainsCorrection('Voltage was 12.4V at battery.', 'Document source voltage 12.4V'), true);
    assert.equal(storyContainsCorrection('No electrical data.', 'Document source voltage 12.4V'), false);
  });

  test('formatPendingCorrectionsBlock is non-empty for details', () => {
    const block = formatPendingCorrectionsBlock([
      { missing: 'A', prompt: 'Add B', field: 'workflow' },
    ]);
    assert.match(block, /PENDING_AUDIT_CORRECTIONS/);
    assert.match(block, /Add B|A/);
  });
});

describe('conservative regenerate prompt', () => {
  const ro: RepairOrder = {
    id: 'ro-1',
    roNumber: '1',
    vehicle: { vin: 'X', year: '2022', make: 'MB', model: 'C', mileageIn: '1', mileageOut: '' },
    customer: { name: 'T' },
    complaints: [],
    repairLines: [],
  };

  test('edit pass uses CURRENT_STORY_TO_EDIT and REQUIRED_CORRECTIONS not from-scratch rewrite', () => {
    const line: RepairLine = {
      id: 'l1',
      lineNumber: 1,
      description: 'Diag',
      customerConcern: '',
      technicianNotes: `Notes here
===PENDING_AUDIT_CORRECTIONS===
1. Add dash in N73/1 designation
===END_PENDING_AUDIT_CORRECTIONS===`,
      warrantyStory: 'Performed road test and confirmed concern. Found P0300. Completed verification drive.',
      xentryImages: [],
      extractedData: { codes: [], faultCodes: [], guidedTests: [], measurements: [], components: [], circuits: [] },
    };
    const msg = buildWarrantyStoryUserMessage(ro, line, { mode: 'auto' });
    assert.match(msg, /EDITING PASS|CURRENT_STORY_TO_EDIT/i);
    assert.match(msg, /REQUIRED_CORRECTIONS/);
    assert.match(msg, /N73\/1/);
    assert.match(msg, /Performed road test/);
    assert.doesNotMatch(msg, /Produce a complete, new 3C narrative from scratch/i);
    assert.match(msg, /Never rewrite from scratch|base document|correcting|Keep every/i);
  });
});
