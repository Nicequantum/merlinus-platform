import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isStoryQualityCurrent,
  normalizeStoryForAudit,
  storiesMatchForAudit,
} from '@/lib/storyQualityState';

describe('story quality state', () => {
  it('detects when scored baseline matches current story', () => {
    const quality = {
      score: 88,
      grade: 'strong' as const,
      strengths: [],
      improvements: [],
      auditRisks: [],
      technicianDetails: [],
      summary: 'Good',
      scoredAgainstStory: 'Customer Complaint: noise\nCause: bearing',
    };
    assert.equal(isStoryQualityCurrent(quality, 'Customer Complaint: noise\nCause: bearing'), true);
    assert.equal(isStoryQualityCurrent(quality, 'Customer Complaint: noise\nCause: bearing\nExtra edit'), false);
  });

  it('treats CDK-normalized stories as equivalent for audit matching', () => {
    const raw = 'Customer Complaint: noise—bearing fault';
    const cdk = normalizeStoryForAudit(raw);
    assert.equal(storiesMatchForAudit(raw, cdk), true);
    assert.equal(isStoryQualityCurrent({ scoredAgainstStory: raw } as never, cdk), true);
  });

  it('does not treat scoredAgainstStory matching itself as free pass for a different live story', () => {
    // Regression: UI used isStoryQualityCurrent(quality, quality.scoredAgainstStory) which is always true.
    const quality = {
      scoredAgainstStory: 'Original audited story text',
    } as never;
    assert.equal(isStoryQualityCurrent(quality, 'Original audited story text'), true);
    assert.equal(isStoryQualityCurrent(quality, 'Original audited story text\n\nAdded tech detail.'), false);
  });
});