import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveCompanionLineStoryState } from '@/lib/companionLineStoryState';
import type { RepairLine, RepairOrder, StoryQualityResult } from '@/types';

function makeLine(overrides: Partial<RepairLine> = {}): RepairLine {
  return {
    id: 'line-1',
    lineNumber: 1,
    description: 'Brake concern',
    customerConcern: '',
    technicianNotes: '',
    warrantyStory: 'Technician inspected brakes and found worn pads.',
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
    roNumber: '12345',
    complaints: [],
    complaintIds: [],
    vehicle: { year: '2024', make: 'Mercedes-Benz', model: 'C300', vin: '', mileageIn: '1000' },
    customer: { name: 'Test', phone: '', email: '' },
    repairLines: lines,
    xentryImages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const quality: StoryQualityResult = {
  score: 88,
  grade: 'B',
  summary: 'Solid story',
  scoredAgainstStory: 'Technician inspected brakes and found worn pads.',
};

describe('deriveCompanionLineStoryState', () => {
  it('uses persisted line audit when hook quality is null', () => {
    const ro = makeRO([makeLine({ storyQualityAudit: quality })]);
    const result = deriveCompanionLineStoryState({
      ro,
      activeLineId: 'line-1',
      storyQuality: null,
      storyReview: null,
      storyQualityStale: false,
      storyCertification: null,
    });

    assert.equal(result.storyQuality?.score, 88);
    assert.equal(result.storyQualityStale, false);
  });

  it('hides quality after story changes (Add Tech Details / regenerate) so stale audit cannot freeze', () => {
    const ro = makeRO([
      makeLine({
        warrantyStory: 'Technician inspected brakes and found worn pads.\n\nSource voltage 12.4V.',
        storyQualityAudit: quality,
      }),
    ]);
    const result = deriveCompanionLineStoryState({
      ro,
      activeLineId: 'line-1',
      storyQuality: quality,
      storyReview: null,
      storyQualityStale: true,
      storyCertification: null,
    });

    assert.equal(result.storyQuality, null);
    assert.equal(result.storyQualityStale, true);
  });

  it('resolves certification from line.storyCertification when hook record is missing', () => {
    const ro = makeRO([
      makeLine({
        storyCertification: {
          certifiedByName: 'Alex Tech',
          certifiedAt: '2026-07-04T12:00:00.000Z',
          storyHash: 'abc',
          certifiedByTechnicianId: 'tech-1',
        },
      }),
    ]);

    const result = deriveCompanionLineStoryState({
      ro,
      activeLineId: 'line-1',
      storyQuality: quality,
      storyReview: null,
      storyQualityStale: false,
      storyCertification: null,
    });

    assert.equal(result.storyCertification?.certifiedByName, 'Alex Tech');
  });

  it('follows activeLineId instead of defaulting to the first repair line', () => {
    const lineOne = makeLine({ id: 'line-1', lineNumber: 1, warrantyStory: 'Line one story' });
    const lineTwo = makeLine({
      id: 'line-2',
      lineNumber: 2,
      warrantyStory: 'Line two story',
      storyQualityAudit: { ...quality, score: 72, scoredAgainstStory: 'Line two story' },
    });
    const ro = makeRO([lineOne, lineTwo]);

    const result = deriveCompanionLineStoryState({
      ro,
      activeLineId: 'line-2',
      storyQuality: null,
      storyReview: null,
      storyQualityStale: false,
      storyCertification: null,
    });

    assert.equal(result.activeLine?.id, 'line-2');
    assert.equal(result.storyQuality?.score, 72);
  });

  it('accepts audit baseline when companion line story has not synced yet', () => {
    const ro = makeRO([makeLine({ warrantyStory: '' })]);
    const result = deriveCompanionLineStoryState({
      ro,
      activeLineId: 'line-1',
      storyQuality: quality,
      storyReview: null,
      storyQualityStale: false,
      storyCertification: null,
    });

    assert.equal(result.storyQuality?.score, 88);
  });
});