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
  const res = await fetch('/api/owner/summary', {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as OwnerNationalSummary & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not load national summary');
  }
  return data;
}