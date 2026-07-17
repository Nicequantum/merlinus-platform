import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  knowledgeBaseForDealershipWhere,
  templateAccessWhere,
  templatesForDealershipWhere,
} from '../../src/lib/saveTemplateFromStory';

describe('template library dealer scope (Phase 3)', () => {
  test('templatesForDealershipWhere keeps global seeds without dealerId filter', () => {
    const where = templatesForDealershipWhere('dealer-1');
    assert.equal(where.OR.length, 2);
    assert.deepEqual(where.OR[0], { dealershipId: '__global__' });
    assert.deepEqual(where.OR[1], { dealershipId: 'dealer-1', source: 'user' });
  });

  test('templatesForDealershipWhere scopes user rows when dealerId is present', () => {
    const where = templatesForDealershipWhere('dealer-1', 'apex-franchise');
    assert.deepEqual(where.OR[1], {
      dealershipId: 'dealer-1',
      source: 'user',
      dealerId: 'apex-franchise',
    });
  });

  test('knowledgeBaseForDealershipWhere mirrors template list scope', () => {
    const where = knowledgeBaseForDealershipWhere('dealer-1', 'apex-franchise');
    assert.deepEqual(where.OR[0], { dealershipId: '__global__' });
    assert.deepEqual(where.OR[1], {
      dealershipId: 'dealer-1',
      source: 'user',
      dealerId: 'apex-franchise',
    });
  });

  test('templateAccessWhere combines id with global or scoped dealership access', () => {
    const where = templateAccessWhere('dealer-1', 'tpl-1', 'apex-franchise');
    assert.equal(where.id, 'tpl-1');
    assert.deepEqual(where.OR[1], {
      dealershipId: 'dealer-1',
      source: 'user',
      dealerId: 'apex-franchise',
    });
  });
});