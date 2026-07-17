import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  scopedRepairLineWhere,
  scopedRepairLineWhereForSession,
  scopedRepairOrderWhere,
  scopedRepairOrderWhereForSession,
} from '../../src/lib/repairOrderAccess';

describe('repair order access scoping (Phase 2.3)', () => {
  test('scopedRepairOrderWhere is dealership-only when dealerId is absent', () => {
    assert.deepEqual(scopedRepairOrderWhere('ro-1', 'd1'), {
      id: 'ro-1',
      dealershipId: 'd1',
    });
    assert.deepEqual(scopedRepairOrderWhere('ro-1', 'd1', null), {
      id: 'ro-1',
      dealershipId: 'd1',
    });
  });

  test('scopedRepairOrderWhere adds dealerId when provided', () => {
    assert.deepEqual(scopedRepairOrderWhere('ro-1', 'd1', 'dealer-x'), {
      id: 'ro-1',
      dealershipId: 'd1',
      dealerId: 'dealer-x',
    });
  });

  test('scopedRepairOrderWhereForSession reads dealerId from session', () => {
    assert.deepEqual(
      scopedRepairOrderWhereForSession('ro-1', { dealershipId: 'd1' }),
      { id: 'ro-1', dealershipId: 'd1' }
    );
    assert.deepEqual(
      scopedRepairOrderWhereForSession('ro-1', { dealershipId: 'd1', dealerId: 'dealer-x' }),
      { id: 'ro-1', dealershipId: 'd1', dealerId: 'dealer-x' }
    );
  });

  test('scopedRepairLineWhere is dealership-only when dealerId is absent', () => {
    assert.deepEqual(scopedRepairLineWhere('line-1', 'ro-1', 'd1'), {
      id: 'line-1',
      repairOrder: { id: 'ro-1', dealershipId: 'd1' },
    });
  });

  test('scopedRepairLineWhere adds dealerId on nested repairOrder when provided', () => {
    assert.deepEqual(scopedRepairLineWhere('line-1', 'ro-1', 'd1', 'dealer-x'), {
      id: 'line-1',
      repairOrder: { id: 'ro-1', dealershipId: 'd1', dealerId: 'dealer-x' },
    });
  });

  test('scopedRepairLineWhereForSession reads dealerId from session', () => {
    assert.deepEqual(
      scopedRepairLineWhereForSession('line-1', 'ro-1', { dealershipId: 'd1', dealerId: 'dealer-x' }),
      {
        id: 'line-1',
        repairOrder: { id: 'ro-1', dealershipId: 'd1', dealerId: 'dealer-x' },
      }
    );
  });
});