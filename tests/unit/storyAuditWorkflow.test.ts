import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

describe('manual story audit workflow', () => {
  test('LineView exposes Audit Story button wired to score handler', () => {
    const lineView = readFileSync(join(process.cwd(), 'src/components/LineView.tsx'), 'utf8');
    assert.match(lineView, /onScoreStory/);
    // UI copy is i18n: line.auditStory / line.auditing
    assert.match(lineView, /t\(['"]auditStory['"]\)|t\(['"]auditing['"]\)/);
    assert.match(lineView, /isScoring/);
  });

  test('useROStoryWorkflow exports manual scoreStory and skips post-generate scoring', () => {
    const workflow = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    assert.match(workflow, /const scoreStory = useCallback/);
    assert.match(workflow, /api\.scoreStory/);
    assert.doesNotMatch(workflow, /void \(async \(\) => \{[\s\S]*api\.scoreStory/);
    assert.match(workflow, /return \{[^}]*scoreStory/);
  });

  test('scoreStory acquires in-flight lock before flushPendingSave', () => {
    const workflow = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    const scoreBlock = workflow.slice(workflow.indexOf('const scoreStory = useCallback'));
    const tryIdx = scoreBlock.indexOf('try {');
    const lockIdx = scoreBlock.indexOf('storyScoringInFlightRef.current = true');
    const flushIdx = scoreBlock.indexOf('flushPendingSave({ maxWaitMs: 2_500 })');
    assert.ok(lockIdx >= 0 && flushIdx >= 0 && tryIdx >= 0);
    assert.ok(lockIdx < flushIdx, 'scoring lock must be set before awaiting save flush');
    assert.match(scoreBlock, /Story audit already in progress/);
  });

  test('reviewStory acquires in-flight lock before flushPendingSave', () => {
    const workflow = readFileSync(join(process.cwd(), 'src/hooks/repairOrders/useROStoryWorkflow.ts'), 'utf8');
    const reviewBlock = workflow.slice(workflow.indexOf('const reviewStory = useCallback'));
    const lockIdx = reviewBlock.indexOf('storyReviewInFlightRef.current = true');
    const flushIdx = reviewBlock.indexOf('flushPendingSave({ maxWaitMs: 2_500 })');
    assert.ok(lockIdx >= 0 && flushIdx >= 0);
    assert.ok(lockIdx < flushIdx, 'review lock must be set before awaiting save flush');
    assert.match(reviewBlock, /AI review already in progress/);
  });

  test('quality loading panel separates generation from audit scoring', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/StoryQualityPanel.tsx'), 'utf8');
    assert.match(panel, /mode === 'scoring'/);
    // i18n key for generation status (en: "Writing your warranty narrative…")
    assert.match(panel, /loadingWriting|t\(['"]loadingWriting['"]\)/);
    assert.doesNotMatch(panel, /Generating story and scoring/i);
  });

  test('StoryQualityPanel wires Add All and per-detail apply actions', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/StoryQualityPanel.tsx'), 'utf8');
    assert.match(panel, /onApplyTechnicianDetail/);
    assert.match(panel, /onApplyAllTechnicianDetails/);
    // i18n key (en: "Add All Tech Details")
    assert.match(panel, /addAllTechDetails|t\(['"]addAllTechDetails['"]\)/);
    assert.match(panel, /detailActionLabel|technicianDetailActionLabel/);
  });

  test('LineView wires tech-detail apply handlers into quality panel', () => {
    const lineView = readFileSync(join(process.cwd(), 'src/components/LineView.tsx'), 'utf8');
    assert.match(lineView, /handleApplyTechnicianDetail/);
    assert.match(lineView, /handleApplyAllTechnicianDetails/);
    assert.match(lineView, /onApplyAllTechnicianDetails/);
    assert.match(lineView, /generateMi|MI_PRODUCT_LABEL/);
    assert.doesNotMatch(lineView, /Generate MI 4\.3/);
  });
});