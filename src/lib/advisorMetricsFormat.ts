export function formatMetricPercent(value: number | null): string {
  return value == null ? '—' : `${value}%`;
}

export function formatMetricCurrency(value: number | null): string {
  return value == null
    ? '—'
    : value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatMetricNumber(value: number | null): string {
  return value == null ? '—' : value.toLocaleString();
}