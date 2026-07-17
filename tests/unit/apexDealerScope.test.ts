import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dealerIdWriteFields,
  scopedDealershipWhere,
  withOptionalDealerId,
  withOptionalDealerIdOnRepairOrderScope,
} from '../../src/lib/apex/dealerScope';

describe('apex dealer scope helpers (Phase 2.1)', () => {
  test('withOptionalDealerId is a no-op when dealerId is absent', () => {
    const where = { dealershipId: 'd1', technicianId: 't1' };
    assert.deepEqual(withOptionalDealerId(where, null), where);
    assert.deepEqual(withOptionalDealerId(where, ''), where);
    assert.deepEqual(withOptionalDealerId(where, '   '), where);
  });

  test('withOptionalDealerId adds trimmed dealerId when provided', () => {
    const where = { dealershipId: 'd1' };
    assert.deepEqual(withOptionalDealerId(where, ' dealer-x '), {
      dealershipId: 'd1',
      dealerId: 'dealer-x',
    });
  });

  test('dealerIdWriteFields returns empty object when dealerId is absent', () => {
    assert.deepEqual(dealerIdWriteFields(null), {});
    assert.deepEqual(dealerIdWriteFields(undefined), {});
    assert.deepEqual(dealerIdWriteFields(''), {});
  });

  test('dealerIdWriteFields returns stamped field when dealerId is present', () => {
    assert.deepEqual(dealerIdWriteFields(' apex-dealer '), { dealerId: 'apex-dealer' });
  });

  test('scopedDealershipWhere is dealership-only when dealerId is absent', () => {
    assert.deepEqual(scopedDealershipWhere('d1', null), { dealershipId: 'd1' });
  });

  test('scopedDealershipWhere adds dealerId when provided', () => {
    assert.deepEqual(scopedDealershipWhere('d1', 'apex-dealer'), {
      dealershipId: 'd1',
      dealerId: 'apex-dealer',
    });
  });

  test('withOptionalDealerIdOnRepairOrderScope preserves id and dealershipId', () => {
    assert.deepEqual(
      withOptionalDealerIdOnRepairOrderScope({ id: 'ro-1', dealershipId: 'd1' }, null),
      { id: 'ro-1', dealershipId: 'd1' }
    );
    assert.deepEqual(
      withOptionalDealerIdOnRepairOrderScope({ id: 'ro-1', dealershipId: 'd1' }, 'dealer-a'),
      { id: 'ro-1', dealershipId: 'd1', dealerId: 'dealer-a' }
    );
  });
});