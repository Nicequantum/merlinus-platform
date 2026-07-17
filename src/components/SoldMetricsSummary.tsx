import { lineSoldTotal } from '@/lib/repairLineSoldMetrics';
import type { RepairLineSoldMetrics } from '@/types';

function formatMoney(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}

export function SoldMetricsSummary({
  metrics,
  compact = false,
}: {
  metrics: RepairLineSoldMetrics;
  compact?: boolean;
}) {
  const total = lineSoldTotal(metrics);

  if (compact) {
    const parts = [
      total > 0 ? formatMoney(total) : null,
      metrics.soldLaborHours != null ? `${metrics.soldLaborHours}h labor` : null,
      metrics.customerApproved === true
        ? 'Approved'
        : metrics.customerApproved === false
          ? 'Declined'
          : null,
      metrics.isAddOn ? 'Add-on' : metrics.isAddOn === false ? 'Original' : null,
    ].filter(Boolean);

    if (parts.length === 0) return null;

    return (
      <div className="text-xs text-benz-secondary mt-1.5 leading-relaxed">
        Sold: {parts.join(' · ')}
      </div>
    );
  }

  return (
    <div className="benz-card p-4">
      <div className="benz-section-title mb-3">Advisor sold metrics</div>
      <div className="grid grid-cols-2 gap-2.5 text-sm">
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Labor hours</div>
          <div className="font-medium mt-1">{metrics.soldLaborHours ?? '—'}</div>
        </div>
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Labor amount</div>
          <div className="font-medium mt-1">{formatMoney(metrics.soldLaborAmount)}</div>
        </div>
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Parts amount</div>
          <div className="font-medium mt-1">{formatMoney(metrics.soldPartsAmount)}</div>
        </div>
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Line total</div>
          <div className="font-medium mt-1">{formatMoney(total > 0 ? total : null)}</div>
        </div>
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Customer approved</div>
          <div className="font-medium mt-1">
            {metrics.customerApproved == null ? '—' : metrics.customerApproved ? 'Yes' : 'No'}
          </div>
        </div>
        <div className="benz-list-row p-3">
          <div className="text-xs text-benz-secondary">Add-on / upsell</div>
          <div className="font-medium mt-1">
            {metrics.isAddOn == null ? '—' : metrics.isAddOn ? 'Yes' : 'No'}
          </div>
        </div>
      </div>
    </div>
  );
}