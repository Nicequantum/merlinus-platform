import 'server-only';

import { decryptPII, encryptJsonObject } from '@/lib/encryption';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';

type DbClient = RlsDbClient;

interface PhraseCount {
  text: string;
  count: number;
}

function topPhrases(observations: Array<{ text: string }>, limit = 12): PhraseCount[] {
  const counts = new Map<string, number>();
  for (const obs of observations) {
    const key = obs.text.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
}

function vehicleAffinity(observations: Array<{ family: string | null }>): Record<string, number> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const obs of observations) {
    if (!obs.family) continue;
    counts.set(obs.family, (counts.get(obs.family) || 0) + 1);
    total += 1;
  }
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [family, count] of counts) {
    out[family] = Math.round((count / total) * 1000) / 1000;
  }
  return out;
}

export async function recomputeAdvisorProfile(
  serviceAdvisorId: string,
  client: DbClient = getRlsDb()
) {
  const observations = await client.advisorComplaintObservation.findMany({
    where: { serviceAdvisorId },
    orderBy: { observedAt: 'desc' },
    take: 500,
    select: {
      complaintTextEncrypted: true,
      vehicleFamily: true,
      repairOrderId: true,
      lineLabel: true,
    },
  });

  const decrypted = observations.map((obs) => ({
    text: decryptPII(obs.complaintTextEncrypted),
    family: obs.vehicleFamily,
    repairOrderId: obs.repairOrderId,
    lineLabel: obs.lineLabel,
  }));

  const roIds = new Set(decrypted.map((o) => o.repairOrderId));
  const avgComplaintsPerRo = roIds.size > 0 ? decrypted.length / roIds.size : 0;
  const avgComplaintLength =
    decrypted.length > 0
      ? decrypted.reduce((sum, item) => sum + item.text.length, 0) / decrypted.length
      : 0;

  const usesLetterLabels =
    decrypted.length > 0
      ? decrypted.filter((item) => item.lineLabel && /^[A-Z]$/.test(item.lineLabel)).length /
        decrypted.length
      : 0;

  const profileData = {
    formatting: {
      usesLetterLabels: usesLetterLabels >= 0.5,
      labelStyle: 'space',
      typicallyAllCaps:
        decrypted.length > 0
          ? decrypted.filter((item) => item.text === item.text.toUpperCase() && /[A-Z]/.test(item.text))
              .length /
              decrypted.length >=
            0.5
          : false,
      avgComplaintsPerRo: Math.round(avgComplaintsPerRo * 100) / 100,
      avgComplaintLength: Math.round(avgComplaintLength),
    },
    abbreviations: {},
    commonPhrases: topPhrases(decrypted),
    vehicleAffinities: vehicleAffinity(decrypted),
    complaintCategories: {},
    extractionHints: [],
  };

  // S2 PLAINTEXT WRITE: profileData JSON may contain complaint phrasing samples — encrypted at rest via profileDataEncrypted.
  const profileDataEncrypted = encryptJsonObject(profileData);

  await client.advisorWritingProfile.upsert({
    where: { serviceAdvisorId },
    create: {
      serviceAdvisorId,
      profileVersion: 1,
      profileDataEncrypted,
      observationCount: observations.length,
      lastComputedAt: new Date(),
    },
    update: {
      profileDataEncrypted,
      observationCount: observations.length,
      lastComputedAt: new Date(),
    },
  });
}