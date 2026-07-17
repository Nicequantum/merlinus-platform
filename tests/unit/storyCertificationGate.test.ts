import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { CRITICAL_AUDIT_ACTIONS, STORY_PROMPT_AUDIT_ACTIONS } from '@/lib/audit';
import {
  auditMetadataMatchesStoryHash,
  STORY_MI_SCORE_AUDIT_ACTIONS,
} from '@/lib/storyCertificationGate';
import { hashWarrantyStory } from '@/lib/storyHash';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import type { StoryQualityResult } from '@/types';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('story certification gate', () => {
  it('matches audit metadata storyHash to certification hash', () => {
    const story = 'Customer states check engine light is on. Cause: P0300. Correction: Replaced coil.';
    const storyHash = hashWarrantyStory(story);
    const metadata = JSON.stringify({ storyHash, qualityScore: 82, qualityGrade: 'strong' });

    assert.equal(auditMetadataMatchesStoryHash(metadata, storyHash), true);
    assert.equal(auditMetadataMatchesStoryHash(metadata, 'deadbeef'), false);
    assert.equal(auditMetadataMatchesStoryHash('not-json', storyHash), false);
  });

  it('treats CDK-normalized story text as current for quality audit baseline', () => {
    const baseline = 'Customer states check engine light is on.';
    const edited = '  Customer states check engine light is on.  ';
    const quality: StoryQualityResult = {
      score: 80,
      grade: 'strong',
      strengths: [],
      improvements: [],
      auditRisks: [],
      technicianDetails: [],
      summary: 'ok',
      scoredAgainstStory: baseline,
      parseFailed: false,
    };

    assert.equal(isStoryQualityCurrent(quality, edited), true);
    assert.equal(isStoryQualityCurrent(quality, 'Different story text entirely.'), false);
  });

  it('registers story.score as a distinct critical prompt-audit action', () => {
    assert.ok(STORY_MI_SCORE_AUDIT_ACTIONS.includes('story.score'));
    assert.ok(STORY_MI_SCORE_AUDIT_ACTIONS.includes('story.review'));
    assert.ok(CRITICAL_AUDIT_ACTIONS.has('story.score'));
    assert.ok(STORY_PROMPT_AUDIT_ACTIONS.has('story.score'));
  });

  it('certify-story route enforces server-side gate under row lock inside transaction', () => {
    const certifyRoute = readSrc(
      'src/app/api/repair-orders/[id]/lines/[lineId]/certify-story/route.ts'
    );
    const scoreRoute = readSrc('src/app/api/repair-orders/[id]/lines/[lineId]/score-story/route.ts');

    assert.ok(certifyRoute.includes('lockRepairLineForCertification'));
    assert.ok(certifyRoute.includes('validateStoryCertificationPrerequisitesInTransaction'));
    assert.ok(certifyRoute.includes('story.certify.gate_rejected'));
    assert.ok(scoreRoute.includes('persistRepairLineStoryInTransaction'));
    assert.ok(scoreRoute.includes('storyHash'));
  });
});