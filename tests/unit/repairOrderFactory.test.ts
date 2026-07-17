import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createRepairOrderFromScan,
  syncRepairLinesWithComplaints,
} from '../../src/utils/repairOrderFactory';

describe('repairOrderFactory', () => {
  test('createRepairOrderFromScan creates one repair line per complaint', async () => {
    const ro = await createRepairOrderFromScan({
      roNumber: '482910',
      vehicle: { vin: '', year: '2022', make: 'Mercedes-Benz', model: 'GLE', mileageIn: '', mileageOut: '' },
      customerName: 'JOHN SMITH',
      complaints: [
        'RHODE ISLAND STATE INSPECTION',
        'CHECK ENGINE LIGHT ON',
        'NOISE FROM REAR SUSPENSION',
        'BRAKE PULSATION AT STOP',
      ],
      complaintLabels: ['A', 'B', 'C', 'D'],
    });

    assert.equal(ro.repairLines.length, 4);
    assert.equal(ro.repairLines[0].customerConcern, 'RHODE ISLAND STATE INSPECTION');
    assert.equal(ro.repairLines[3].customerConcern, 'BRAKE PULSATION AT STOP');
    assert.equal(ro.repairLines[0].lineNumber, 1);
    assert.equal(ro.repairLines[3].lineNumber, 4);
    assert.ok(ro.repairLines[0].description.startsWith('A.'));
    assert.ok(ro.repairLines[3].description.startsWith('D.'));
  });

  test('syncRepairLinesWithComplaints adds lines when complaints grow', async () => {
    const existing = (await createRepairOrderFromScan({
      roNumber: '1',
      vehicle: { vin: '', year: '', make: '', model: '', mileageIn: '', mileageOut: '' },
      customerName: 'Test',
      complaints: ['Concern A'],
      complaintLabels: ['A'],
    })).repairLines;

    const synced = syncRepairLinesWithComplaints(
      existing,
      ['Concern A', 'Concern B', 'Concern C'],
      ['A', 'B', 'C']
    );

    assert.equal(synced.length, 3);
    assert.equal(synced[1].customerConcern, 'Concern B');
    assert.equal(synced[2].customerConcern, 'Concern C');
  });
});