import 'server-only';

import type { AdvisorListItem, AdvisorPerformanceMetrics, AdvisorProfileData } from '@/types';
import { decryptJsonObject } from '@/lib/encryption';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';

const EMPTY_PROFILE_SUMMARY = {
  typicallyAllCaps: false,
  commonPhraseCount: 0,
} as const;

type AdvisorWithProfile = {
  id: string;
  displayNameEncrypted?: string;
  advisorCode: string | null;
  status: string;
  roCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  csiScore: number | null;
  profile: {
    observationCount: number;
    lastComputedAt: Date | null;
    profileDataEncrypted: string;
  } | null;
};

export function parseAdvisorProfileSummary(profileDataEncrypted: string | undefined | null): {
  typicallyAllCaps: boolean;
  commonPhraseCount: number;
} {
  if (!profileDataEncrypted) {
    return EMPTY_PROFILE_SUMMARY;
  }
  const data = decryptJsonObject<{
    formatting?: { typicallyAllCaps?: boolean };
    commonPhrases?: unknown[];
  } | null>(profileDataEncrypted, null);
  if (!data) {
    return EMPTY_PROFILE_SUMMARY;
  }
  return {
    typicallyAllCaps: Boolean(data.formatting?.typicallyAllCaps),
    commonPhraseCount: data.commonPhrases?.length ?? 0,
  };
}

export function mapAdvisorListItem(
  advisor: AdvisorWithProfile,
  metrics: AdvisorPerformanceMetrics
): AdvisorListItem {
  const { typicallyAllCaps, commonPhraseCount } = parseAdvisorProfileSummary(
    advisor.profile?.profileDataEncrypted
  );

  return {
    id: advisor.id,
    displayName: readAdvisorDisplayNameFromDb(advisor),
    advisorCode: advisor.advisorCode,
    status: advisor.status as 'active' | 'inactive',
    roCount: advisor.roCount,
    firstSeenAt: advisor.firstSeenAt.toISOString(),
    lastSeenAt: advisor.lastSeenAt.toISOString(),
    createdAt: advisor.createdAt.toISOString(),
    observationCount: advisor.profile?.observationCount ?? 0,
    profileUpdatedAt: advisor.profile?.lastComputedAt?.toISOString() ?? null,
    typicallyAllCaps,
    commonPhraseCount,
    metrics,
  };
}

export function parseAdvisorProfileData(raw: string | null | undefined): AdvisorProfileData | null {
  if (!raw) return null;
  return decryptJsonObject<AdvisorProfileData | null>(raw, null);
}