import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getStartOfDealershipDay, isRepairOrderActiveToday } from '../../src/lib/dealershipDayBoundary';
import { buildRepairOrderListWhere, parseRepairOrderListParams } from '../../src/lib/roListQuery';

process.env.DATA_ENCRYPTION_KEY =
  process.env.DATA_ENCRYPTION_KEY || 'test-data-encryption-key-32-chars-min';
process.env.SEARCH_HMAC_KEY =
  process.env.SEARCH_HMAC_KEY || 'test-search-hmac-key-32-chars-minimum!';

describe('repair order list query', () => {
  test('defaults to today scope with pagination limit', () => {
    const params = parseRepairOrderListParams(new URL('http://localhost/api/repair-orders'));
    assert.equal(params.scope, 'today');
    assert.equal(params.limit, 50);
    assert.equal(params.q, undefined);
  });

  test('parses previous scope and search query', () => {
    const params = parseRepairOrderListParams(
      new URL('http://localhost/api/repair-orders?scope=previous&limit=25&cursor=abc&q=C300')
    );
    assert.equal(params.scope, 'previous');
    assert.equal(params.limit, 25);
    assert.equal(params.cursor, 'abc');
    assert.equal(params.q, 'C300');
  });

  test('today where clause filters updatedAt since dealership midnight', () => {
    const where = buildRepairOrderListWhere(
      { role: 'technician', dealershipId: 'd1', technicianId: 't1' },
      { scope: 'today', limit: 50 }
    );
    assert.equal(where.technicianId, 't1');
    assert.equal(where.dealerId, undefined);
    assert.ok(where.updatedAt && 'gte' in where.updatedAt);
    assert.ok((where.updatedAt as { gte: Date }).gte instanceof Date);
  });

  test('optional dealerId adds defense-in-depth tenant filter', () => {
    const where = buildRepairOrderListWhere(
      { role: 'manager', dealershipId: 'd1', technicianId: 't1', dealerId: 'apex-dealer' },
      { scope: 'today', limit: 50 }
    );
    assert.equal(where.dealershipId, 'd1');
    assert.equal(where.dealerId, 'apex-dealer');
  });

  test('previous where clause filters before dealership midnight', () => {
    const where = buildRepairOrderListWhere(
      { role: 'manager', dealershipId: 'd1', technicianId: 't1' },
      { scope: 'previous', limit: 25 }
    );
    assert.equal(where.dealershipId, 'd1');
    assert.ok(where.updatedAt && 'lt' in where.updatedAt);
    assert.ok((where.updatedAt as { lt: Date }).lt instanceof Date);
  });

  test('service advisor where clause scopes to linked advisor profile', () => {
    const where = buildRepairOrderListWhere(
      {
        role: 'service_advisor',
        dealershipId: 'd1',
        technicianId: 't1',
        serviceAdvisorId: 'sa-1',
      },
      { scope: 'today', limit: 50 }
    );
    assert.equal(where.dealershipId, 'd1');
    assert.equal(where.serviceAdvisorId, 'sa-1');
  });

  test('search where clause matches RO number and vehicle fields', () => {
    const where = buildRepairOrderListWhere(
      { role: 'technician', dealershipId: 'd1', technicianId: 't1' },
      { scope: 'today', limit: 50, q: 'WDD' }
    );
    assert.ok(Array.isArray(where.OR));
    assert.equal(where.OR?.length, 4);
    const firstClause = where.OR?.[0] as { roNumberSearchTokens?: { hasSome: string[] } };
    assert.ok(firstClause.roNumberSearchTokens?.hasSome?.length);
  });

  test('isRepairOrderActiveToday respects updatedAt boundary', () => {
    const start = getStartOfDealershipDay(new Date('2026-06-24T18:00:00.000Z'), 'UTC').toISOString();
    assert.equal(isRepairOrderActiveToday('2026-06-24T19:00:00.000Z', start), true);
    assert.equal(isRepairOrderActiveToday('2026-06-23T19:00:00.000Z', start), false);
  });
});