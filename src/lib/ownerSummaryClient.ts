import { fetchJsonWithClientRetry } from '@/lib/clientFetchRetry';
import type {
  OwnerAttentionFlag,
  OwnerNationalSummary,
  OwnerRooftopScorecard,
  OwnerTrendSeries,
} from '@/lib/apex/ownerNationalSummary';

export type {
  OwnerAttentionFlag,
  OwnerNationalSummary,
  OwnerRooftopScorecard,
  OwnerTrendSeries,
};

export async function fetchOwnerNationalSummary(): Promise<OwnerNationalSummary> {
  return fetchJsonWithClientRetry<OwnerNationalSummary>('/api/owner/summary', {
    method: 'GET',
    // Summary is heavy (multi-query); allow cold-start recovery time.
    timeoutMs: 30_000,
    maxRetries: 3,
  });
}
