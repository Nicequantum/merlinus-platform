import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isXentryAnalysisFailure,
  xentryAnalysisFailureDetail,
} from '@/hooks/repairOrders/xentryToastHelpers';

describe('Xentry toast failure detection (H3)', () => {
  it('detects colon-style analysis failures', () => {
    assert.ok(isXentryAnalysisFailure('[Analysis failed: Grok timeout]'));
    assert.equal(xentryAnalysisFailureDetail('[Analysis failed: Grok timeout]'), 'Grok timeout');
  });

  it('detects per-image catch failures', () => {
    assert.ok(isXentryAnalysisFailure('[Analysis failed for this image]'));
    assert.match(
      xentryAnalysisFailureDetail('[Analysis failed for this image]'),
      /sharper photo/i
    );
  });

  it('detects empty extraction failures', () => {
    assert.ok(isXentryAnalysisFailure('[No diagnostic text extracted from image]'));
    assert.match(
      xentryAnalysisFailureDetail('[No diagnostic text extracted from image]'),
      /No diagnostic text/i
    );
  });

  it('does not flag successful extraction text', () => {
    assert.equal(isXentryAnalysisFailure('P0300 Cylinder 1 misfire'), false);
  });
});