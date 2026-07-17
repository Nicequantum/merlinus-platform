import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  STYLE_VARIATION_SYSTEM_RULES,
  buildStoryStyleVariationBlock,
} from '../../src/prompts/storyStyleVariation';

describe('story style variation', () => {
  test('STYLE_VARIATION_SYSTEM_RULES covers all variation dimensions', () => {
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /Sentence structure and rhythm/i);
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /Level of technical detail/i);
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /Order of information/i);
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /Transitional phrases/i);
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /Formality/i);
    assert.match(STYLE_VARIATION_SYSTEM_RULES, /BENZ BOT EVASION/i);
  });

  test('buildStoryStyleVariationBlock includes per-story profile fields', () => {
    const block = buildStoryStyleVariationBlock();
    assert.match(block, /Style variation for THIS story/i);
    assert.match(block, /Sentence rhythm:/i);
    assert.match(block, /Technical detail emphasis:/i);
    assert.match(block, /Information order:/i);
    assert.match(block, /Transitional phrasing:/i);
    assert.match(block, /Tone:/i);
  });

  test('buildStoryStyleVariationBlock produces different profiles across calls', () => {
    const samples = new Set(Array.from({ length: 12 }, () => buildStoryStyleVariationBlock()));
    assert.ok(samples.size > 1, 'expected random variation across multiple generations');
  });
});