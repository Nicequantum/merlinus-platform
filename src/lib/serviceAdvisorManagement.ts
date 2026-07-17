import 'server-only';

import { dealerIdWriteFields } from '@/lib/apex/dealerScope';
import { getRlsDb, type RlsDbClient } from '@/lib/apex/rlsContext';
import { encryptJsonObject, encryptPII } from '@/lib/encryption';
import {
  fingerprintAdvisorName,
  isPlausibleAdvisorName,
  normalizeAdvisorDisplayName,
} from '@/lib/advisorIntelligence/nameUtils';
import { isServiceAdvisorActive } from '@/lib/serviceAdvisorAccounts';

const EMPTY_PROFILE = {
  formatting: {},
  abbreviations: {},
  commonPhrases: [],
  vehicleAffinities: {},
  complaintCategories: {},
  extractionHints: [],
};

export class AdvisorManagementError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = 'AdvisorManagementError';
  }
}

export interface ManualAdvisorInput {
  displayName: string;
  advisorCode?: string | null;
}

type DbClient = RlsDbClient;

export async function createManualServiceAdvisor(
  dealershipId: string,
  input: ManualAdvisorInput,
  client: DbClient = getRlsDb(),
  dealerId?: string | null
) {
  const dealerFields = dealerIdWriteFields(dealerId);
  const displayName = normalizeAdvisorDisplayName(input.displayName);
  const nameFingerprint = fingerprintAdvisorName(displayName);
  if (!nameFingerprint || !isPlausibleAdvisorName(displayName)) {
    throw new AdvisorManagementError('Enter a valid service advisor name (at least 3 characters).');
  }

  const existing = await client.serviceAdvisor.findUnique({
    where: {
      dealershipId_nameFingerprint: {
        dealershipId,
        nameFingerprint,
      },
    },
  });

  if (existing) {
    if (existing.deletedAt) {
      const restored = await client.serviceAdvisor.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          status: 'active',
          displayNameEncrypted: encryptPII(displayName),
          advisorCode: input.advisorCode?.trim() || existing.advisorCode,
          lastSeenAt: new Date(),
          ...dealerFields,
        },
      });
      return { advisor: restored, reactivated: true as const };
    }

    if (isServiceAdvisorActive(existing)) {
      throw new AdvisorManagementError('A service advisor with this name already exists.', 409);
    }

    const reactivated = await client.serviceAdvisor.update({
      where: { id: existing.id },
      data: {
        status: 'active',
        displayNameEncrypted: encryptPII(displayName),
        advisorCode: input.advisorCode?.trim() || existing.advisorCode,
        lastSeenAt: new Date(),
        ...dealerFields,
      },
    });
    return { advisor: reactivated, reactivated: true as const };
  }

  const created = await client.serviceAdvisor.create({
    data: {
      dealershipId,
      ...dealerFields,
      displayNameEncrypted: encryptPII(displayName),
      nameFingerprint,
      advisorCode: input.advisorCode?.trim() || null,
      aliases: {
        create: {
          aliasText: displayName,
          aliasFingerprint: nameFingerprint,
        },
      },
      profile: {
        create: {
          profileDataEncrypted: encryptJsonObject(EMPTY_PROFILE),
        },
      },
    },
  });

  return { advisor: created, reactivated: false as const };
}