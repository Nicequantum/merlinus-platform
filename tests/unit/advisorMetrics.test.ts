import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ADVISOR_APPROVAL_SCORE_THRESHOLD,
  buildAdvisorMetricsFromAccumulator,
  formatMetricCurrency,
  formatMetricPercent,
} from '@/lib/advisorMetrics';

describe('advisorMetrics', () => {
  it('computes approval, closing, and upsell rates from accumulator', () => {
    const metrics = buildAdvisorMetricsFromAccumulator({
      rosWritten: 4,
      totalLines: 10,
      customerPayLines: 2,
      auditedLines: 8,
      approvedAudits: 6,
      warrantyLinesWithStory: 5,
      certifiedStories: 3,
      soldApprovalLines: 8,
      approvedSoldLines: 6,
      soldAddOnLines: 5,
      addOnLines: 2,
      totalRevenue: 4200,
      roValueCount: 3,
      csiScore: 92,
    });

    assert.equal(metrics.rosWritten, 4);
    assert.equal(metrics.approvalRate, 75);
    assert.equal(metrics.closingRatio, 60);
    assert.equal(metrics.upsellRate, 40);
    assert.equal(metrics.csiScore, 92);
    assert.equal(metrics.totalRevenue, 4200);
    assert.equal(metrics.avgRepairOrderValue, 1400);
  });

  it('formats unavailable metrics gracefully', () => {
    assert.equal(formatMetricPercent(null), '—');
    assert.equal(formatMetricPercent(82.4), '82.4%');
    assert.equal(formatMetricCurrency(null), '—');
  });

  it('uses MI audit threshold of 75', () => {
    assert.equal(ADVISOR_APPROVAL_SCORE_THRESHOLD, 75);
  });
});