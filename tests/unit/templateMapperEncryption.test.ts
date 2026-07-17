import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { encryptOptionalSensitiveText, encryptSensitiveText } from '../../src/lib/encryption';
import { mapKnowledgeBase, mapTemplate } from '../../src/lib/templateLibrary';

describe('template and knowledge base field encryption', () => {
  before(() => {
    process.env.DATA_ENCRYPTION_KEY =
      process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
    process.env.SEARCH_HMAC_KEY =
      process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';
  });

  test('mapTemplate decrypts stored template content', () => {
    const content = 'Customer presented with check engine light. Verified P0300 and replaced coil.';
    const mapped = mapTemplate({
      id: 'tpl-1',
      title: 'Engine Misfire',
      category: 'warranty',
      contentEncrypted: encryptSensitiveText(content),
      source: 'user',
      dealershipId: 'dealer-1',
      useCount: 2,
      lastUsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(mapped.content, content);
  });

  test('mapKnowledgeBase decrypts stored knowledge base text fields', () => {
    const finalText = 'Approved final warranty story text.';
    const generated = 'Grok draft before technician edits.';
    const mapped = mapKnowledgeBase({
      id: 'kb-1',
      title: 'Engine Misfire',
      category: 'warranty',
      generatedTextEncrypted: encryptOptionalSensitiveText(generated),
      fullOriginalTextEncrypted: encryptSensitiveText(finalText),
      cleanTemplateEncrypted: encryptSensitiveText(finalText),
      tags: '["p0300"]',
      source: 'user',
      dealershipId: 'dealer-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.equal(mapped.fullOriginalText, finalText);
    assert.equal(mapped.cleanTemplate, finalText);
    assert.equal(mapped.generatedText, generated);
  });
});