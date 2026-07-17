import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  companionSnapshotHasChanges,
  diffCompanionRepairOrder,
} from '@/lib/companionSnapshot';
import type { RepairLine, RepairOrder } from '@/types';

function makeLine(overrides: Partial<RepairLine> = {}): RepairLine {
  return {
    id: 'line-1',
    lineNumber: 1,
    description: 'Brakes',
    customerConcern: 'Noise',
    technicianNotes: '',
    warrantyStory: 'Story text',
    isCustomerPay: false,
    soldMetrics: null,
    storyQualityAudit: null,
    storyCertification: null,
    xentryImages: [],
    ...overrides,
  };
}

function makeRO(lines: RepairLine[]): RepairOrder {
  return {
    id: 'ro-1',
    roNumber: '1001',
    complaints: [],
    complaintIds: [],
    vehicle: { year: '2024', make: 'Mercedes-Benz', model: 'C300', vin: '', mileageIn: '100' },
    customer: { name: 'Test', phone: '', email: '' },
    repairLines: lines,
    xentryImages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('companion snapshot diff', () => {
  it('detects audit score and certification changes', () => {
    const previous = makeRO([makeLine()]);
    const next = makeRO([
      makeLine({
        storyQualityAudit: {
          score: 82,
          grade: 'B',
          summary: 'Good',
          scoredAgainstStory: 'Story text',
        },
        storyCertification: {
          certifiedByName: 'Alex',
          certifiedAt: '2026-07-04T12:00:00.000Z',
          storyHash: 'hash',
          certifiedByTechnicianId: 'tech-1',
        },
      }),
    ]);

    const delta = diffCompanionRepairOrder(previous, next);
    assert.equal(delta.auditCompleted.length, 1);
    assert.equal(delta.auditCompleted[0]?.score, 82);
    assert.equal(delta.newlyCertified.length, 1);
    assert.ok(companionSnapshotHasChanges(delta));
  });

  it('returns no changes when repair order is unchanged', () => {
    const ro = makeRO([makeLine({ storyQualityAudit: { score: 70, grade: 'C', summary: 'OK' } })]);
    const delta = diffCompanionRepairOrder(ro, ro);
    assert.equal(companionSnapshotHasChanges(delta), false);
  });

  it('detects RO and line diagnostic photo changes', () => {
    const previous = makeRO([makeLine()]);
    const next = makeRO([
      makeLine({
        xentryImages: [{ id: 'x1', pathname: '/x1', url: 'https://example.com/x1.jpg', name: 'x1.jpg' }],
      }),
    ]);
    next.xentryImages = [{ id: 'r1', pathname: '/r1', url: 'https://example.com/r1.jpg', name: 'r1.jpg' }];

    const delta = diffCompanionRepairOrder(previous, next);
    assert.equal(delta.photosUpdated.length, 2);
    assert.ok(delta.photosUpdated.some((entry) => entry.scope === 'ro'));
    assert.ok(delta.photosUpdated.some((entry) => entry.scope === 'line' && entry.lineId === 'line-1'));
    assert.ok(companionSnapshotHasChanges(delta));
  });
});