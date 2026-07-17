import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  appendUniqueDetailText,
  applyAllTechnicianDetails,
  applyTechnicianDetail,
  formatTechnicianDetailForStory,
  formatTechnicianDetailInsert,
  technicianDetailActionLabel,
} from '../../src/lib/applyTechnicianDetails';
import {
  GENERATE_STORY_BUTTON_LABEL,
  MI_PRODUCT_LABEL,
  STORY_MODEL_DISPLAY_VERSION,
  parseGrokModelVersion,
} from '../../src/lib/grokModels';
import { truncatePromptField } from '../../src/prompts/story/shared/fieldLimits';
import type { TechnicianDetailPrompt } from '../../src/types';

describe('applyTechnicianDetails', () => {
  test('appends diagnostic into notes AND warranty story', () => {
    const line = {
      technicianNotes: 'Found P0300.',
      customerConcern: 'CEL on',
      warrantyStory: 'Road tested and confirmed misfire.',
    };
    const diagnostic: TechnicianDetailPrompt = {
      missing: 'Guided test result',
      prompt: 'Record guided test result for cylinder 3.',
      field: 'diagnostic',
    };
    const patch = applyTechnicianDetail(line, diagnostic);
    assert.match(patch.technicianNotes || '', /\[Audit enhancement\]/);
    assert.match(patch.technicianNotes || '', /\[Diagnostic\]/);
    assert.match(patch.technicianNotes || '', /cylinder 3/i);
    assert.match(patch.warrantyStory || '', /cylinder 3/i);
    assert.match(patch.warrantyStory || '', /Road tested/);
    assert.doesNotMatch(patch.warrantyStory || '', /^Record /i);
  });

  test('appends customerConcern field into concern + story', () => {
    const line = {
      technicianNotes: 'Notes',
      customerConcern: 'Noise',
      warrantyStory: 'Verified noise on road test.',
    };
    const detail: TechnicianDetailPrompt = {
      missing: 'When noise occurs',
      prompt: 'Document when noise occurs (cold/hot).',
      field: 'customerConcern',
    };
    const patch = applyTechnicianDetail(line, detail);
    assert.match(patch.customerConcern || '', /when noise occurs/i);
    assert.match(patch.warrantyStory || '', /noise occurs/i);
  });

  test('apply all merges every detail into story without duplicating', () => {
    const line = {
      technicianNotes: '',
      customerConcern: '',
      warrantyStory: 'Initial story.',
    };
    const details: TechnicianDetailPrompt[] = [
      { missing: 'A', prompt: 'Add voltage reading of 12.4V.', field: 'technicianNotes' },
      { missing: 'B', prompt: 'Add final road test miles.', field: 'workflow' },
    ];
    const once = applyAllTechnicianDetails(line, details);
    assert.match(once.warrantyStory || '', /12\.4V|voltage/i);
    assert.match(once.warrantyStory || '', /road test/i);
    assert.match(once.technicianNotes || '', /\[Audit enhancement\]/);
    assert.match(once.technicianNotes || '', /\[Workflow\]/);

    const twice = applyAllTechnicianDetails(
      {
        technicianNotes: once.technicianNotes || '',
        customerConcern: once.customerConcern || '',
        warrantyStory: once.warrantyStory || '',
      },
      details
    );
    assert.equal(twice.warrantyStory, undefined);
  });

  test('formatTechnicianDetailForStory strips coaching imperatives', () => {
    const text = formatTechnicianDetailForStory({
      missing: 'Source voltage',
      prompt: 'Add the source voltage reading at the battery.',
      field: 'workflow',
    });
    assert.doesNotMatch(text, /^Add /i);
    assert.match(text, /source voltage|battery/i);
  });

  test('appendUniqueDetailText is idempotent', () => {
    assert.equal(appendUniqueDetailText('hello', 'hello'), 'hello');
    assert.equal(appendUniqueDetailText('hello', 'world'), 'hello\n\nworld');
  });

  test('format and action labels', () => {
    assert.match(formatTechnicianDetailInsert({ missing: 'X', prompt: 'Y', field: 'workflow' }), /Y/);
    assert.equal(technicianDetailActionLabel('diagnostic'), 'Add Diagnostic to Story');
    assert.equal(technicianDetailActionLabel('workflow'), 'Add Workflow to Story');
  });
});

describe('notes truncation for tech-detail appends', () => {
  test('preferEnd keeps the newest content', () => {
    const old = 'A'.repeat(100);
    const newest = 'NEW_DETAIL_BLOCK_XYZ';
    const combined = `${old}\n\n${newest}`;
    const truncated = truncatePromptField(combined, 40, { preferEnd: true });
    assert.match(truncated, /NEW_DETAIL_BLOCK_XYZ/);
    assert.doesNotMatch(truncatePromptField(combined, 40), /NEW_DETAIL_BLOCK_XYZ/);
  });
});

describe('story model display labels', () => {
  test('parses grok model ids to short versions', () => {
    assert.equal(parseGrokModelVersion('grok-4.20-0309-non-reasoning'), '4.20');
    assert.equal(parseGrokModelVersion('grok-4.3'), '4.3');
  });

  test('UI product label reflects current story model (not legacy 4.3)', () => {
    assert.equal(STORY_MODEL_DISPLAY_VERSION, '4.20');
    assert.equal(MI_PRODUCT_LABEL, 'MI 4.20');
    assert.equal(GENERATE_STORY_BUTTON_LABEL, 'Generate MI 4.20');
  });
});
