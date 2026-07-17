import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filterApexDealerships,
  sortApexDealerships,
} from '../../src/lib/apexDealershipOptions';

describe('apexDealershipOptions (Phase 5.8)', () => {
  const sample = [
    { id: 'b', name: 'Boston Motors', dealerCode: 'BOS', isPrimary: false },
    { id: 'a', name: 'Austin Apex', dealerCode: 'AUS', isPrimary: true },
    { id: 'c', name: 'Chicago Center', dealerCode: null, isPrimary: false },
  ];

  test('filterApexDealerships matches name and dealer code', () => {
    assert.deepEqual(filterApexDealerships(sample, 'bos'), [sample[0]]);
    assert.deepEqual(filterApexDealerships(sample, 'apex'), [sample[1]]);
    assert.equal(filterApexDealerships(sample, 'zzz').length, 0);
    assert.equal(filterApexDealerships(sample, '').length, 3);
  });

  test('sortApexDealerships puts primary first then alphabetical', () => {
    const sorted = sortApexDealerships(sample);
    assert.equal(sorted[0]?.id, 'a');
    assert.equal(sorted[1]?.id, 'b');
    assert.equal(sorted[2]?.id, 'c');
  });
});