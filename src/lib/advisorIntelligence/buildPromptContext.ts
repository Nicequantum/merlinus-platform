import 'server-only';

import { decryptJsonObject, decryptPII } from '@/lib/encryption';
import { readAdvisorDisplayNameFromDb } from '@/lib/piiFieldRead';
import { getRlsDb } from '@/lib/apex/rlsContext';

export interface AdvisorProfileData {
  formatting: {
    usesLetterLabels: boolean;
    labelStyle: string;
    typicallyAllCaps: boolean;
    avgComplaintsPerRo: number;
    avgComplaintLength: number;
  };
  abbreviations: Record<string, string>;
  commonPhrases: Array<{ text: string; count: number }>;
  vehicleAffinities: Record<string, number>;
  complaintCategories: Record<string, unknown>;
  extractionHints: string[];
}

export interface AdvisorPromptContext {
  serviceAdvisorId: string;
  displayName: string;
  observationCount: number;
  profileData: AdvisorProfileData;
  sampleComplaints: string[];
}

const EMPTY_PROFILE: AdvisorProfileData = {
  formatting: {
    usesLetterLabels: false,
    labelStyle: 'space',
    typicallyAllCaps: false,
    avgComplaintsPerRo: 0,
    avgComplaintLength: 0,
  },
  abbreviations: {},
  commonPhrases: [],
  vehicleAffinities: {},
  complaintCategories: {},
  extractionHints: [],
};

function parseProfileData(raw: string): AdvisorProfileData {
  const parsed = decryptJsonObject<Partial<AdvisorProfileData> | null>(raw, null);
  if (!parsed) {
    return EMPTY_PROFILE;
  }
  return {
    formatting: { ...EMPTY_PROFILE.formatting, ...parsed.formatting },
    abbreviations: parsed.abbreviations ?? {},
    commonPhrases: parsed.commonPhrases ?? [],
    vehicleAffinities: parsed.vehicleAffinities ?? {},
    complaintCategories: parsed.complaintCategories ?? {},
    extractionHints: parsed.extractionHints ?? [],
  };
}

/** Format advisor intelligence for injection into warranty story prompts. */
export function formatAdvisorContextForPrompt(ctx: AdvisorPromptContext): string {
  const { displayName, profileData, sampleComplaints, observationCount } = ctx;
  const fmt = profileData.formatting;

  const lines = [
    `SERVICE ADVISOR WRITING PROFILE — ${displayName}`,
    `Based on ${observationCount} confirmed complaint observation(s) from scanned repair orders.`,
    '',
    'STYLE GUIDANCE (Customer Complaint phrasing only — never invent diagnostic facts):',
  ];

  if (fmt.typicallyAllCaps) {
    lines.push('- This advisor typically writes customer concerns in ALL CAPS.');
  }
  if (fmt.usesLetterLabels) {
    lines.push('- Expects letter-labeled complaints (A, B, C) on the RO.');
  }
  if (fmt.avgComplaintLength > 0) {
    lines.push(`- Typical complaint length: ~${fmt.avgComplaintLength} characters.`);
  }

  if (profileData.commonPhrases.length > 0) {
    lines.push('', 'Frequent complaint phrases:');
    for (const phrase of profileData.commonPhrases.slice(0, 6)) {
      lines.push(`  • "${phrase.text}" (seen ${phrase.count}x)`);
    }
  }

  if (sampleComplaints.length > 0) {
    lines.push('', 'Recent complaint examples (match tone when writing the Customer Complaint section):');
    for (const complaint of sampleComplaints.slice(0, 4)) {
      lines.push(`  • ${complaint}`);
    }
  }

  const affinities = Object.entries(profileData.vehicleAffinities).sort((a, b) => b[1] - a[1]);
  if (affinities.length > 0) {
    const summary = affinities
      .slice(0, 4)
      .map(([family, weight]) => `${family} (${Math.round(weight * 100)}%)`)
      .join(', ');
    lines.push('', `Common vehicle families on this advisor's ROs: ${summary}`);
  }

  lines.push(
    '',
    'RULES FOR USING THIS PROFILE:',
    '- Apply ONLY to how you phrase the Customer Complaint/Concern section.',
    '- Cause and Correction must still use ONLY current-line diagnostic data and technician notes.',
    '- Never transplant example complaints onto this repair unless they match the actual RO complaints.',
    '- Never treat advisor style hints as performed tests, codes, or measurements.'
  );

  return lines.join('\n');
}

export async function loadAdvisorPromptContext(
  serviceAdvisorId: string
): Promise<AdvisorPromptContext | null> {
  const advisor = await getRlsDb().serviceAdvisor.findUnique({
    where: { id: serviceAdvisorId, status: 'active' },
    include: {
      profile: true,
      observations: {
        orderBy: { observedAt: 'desc' },
        take: 5,
        select: { complaintTextEncrypted: true },
      },
    },
  });

  if (!advisor?.profile || advisor.profile.observationCount < 1) {
    return null;
  }

  const sampleComplaints = advisor.observations
    .map((obs) => decryptPII(obs.complaintTextEncrypted))
    .filter((text) => text.length >= 3);

  return {
    serviceAdvisorId: advisor.id,
    displayName: readAdvisorDisplayNameFromDb(advisor),
    observationCount: advisor.profile.observationCount,
    profileData: parseProfileData(advisor.profile.profileDataEncrypted),
    sampleComplaints,
  };
}

export async function loadAdvisorPromptContextForRepairOrder(
  repairOrderId: string
): Promise<AdvisorPromptContext | null> {
  const ro = await getRlsDb().repairOrder.findUnique({
    where: { id: repairOrderId },
    select: { serviceAdvisorId: true },
  });
  if (!ro?.serviceAdvisorId) return null;
  return loadAdvisorPromptContext(ro.serviceAdvisorId);
}