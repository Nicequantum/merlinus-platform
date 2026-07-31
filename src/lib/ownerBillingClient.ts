import { fetchJsonWithClientRetry } from '@/lib/clientFetchRetry';
import type {
  OwnerBillingPeriod,
  OwnerBillingSummary,
} from '@/lib/apex/ownerBillingSummary';

export type { OwnerBillingPeriod, OwnerBillingSummary };

export async function fetchOwnerBillingSummary(
  period: OwnerBillingPeriod = '30d'
): Promise<OwnerBillingSummary> {
  const q = new URLSearchParams({ period });
  return fetchJsonWithClientRetry<OwnerBillingSummary>(`/api/owner/billing?${q}`, {
    method: 'GET',
    timeoutMs: 30_000,
    maxRetries: 2,
  });
}

export function formatUsdFromCents(cents: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
