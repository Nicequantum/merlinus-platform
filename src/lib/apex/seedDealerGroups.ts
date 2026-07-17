import 'server-only';

import bcrypt from 'bcryptjs';
import { isApexUsernameCredential, normalizeApexUsername } from '@/lib/apex/credentialType';
import {
  APEX_NATIONAL_DEALERSHIP_ID,
  APEX_NATIONAL_DEALERSHIP_NAME,
} from '@/lib/apex/platformConstants';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';

/** Stable seed id for Viti Automotive Group (ops-friendly). */
export const VITI_AUTO_DEALER_GROUP_ID = 'dealer-group-viti-auto';
export const VITI_AUTO_DEALER_GROUP_CODE = 'VITI-AUTO';
export const VITI_AUTO_DEALER_CODES = ['VITIMB', 'VITIVOLVO'] as const;

/** Default Apex username for James Gray (override with VITI_AUTO_OWNER_USERNAME). */
export const VITI_AUTO_OWNER_DEFAULT_USERNAME = 'viti.james.gray';

const seedCompliance = {
  consentAt: new Date(),
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: new Date(),
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
};

function stripEnvQuotes(value: string | undefined): string {
  let v = value?.trim() ?? '';
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export interface VitiAutoGroupSeedResult {
  dealerGroupId: string;
  dealerGroupCode: string;
  linkedDealerCodes: string[];
  ownerId: string | null;
  ownerUsername: string | null;
  ownerEmail: string | null;
  skippedOwner: boolean;
  skipReason?: string;
}

/**
 * Ensure DealerGroup VITI-AUTO exists and link VITIMB + VITIVOLVO when present.
 * Optionally seed group owner James Gray when VITI_AUTO_OWNER_PASSWORD is set.
 */
export async function seedVitiAutomotiveGroup(): Promise<VitiAutoGroupSeedResult> {
  await prisma.dealership.upsert({
    where: { id: APEX_NATIONAL_DEALERSHIP_ID },
    update: { name: APEX_NATIONAL_DEALERSHIP_NAME },
    create: { id: APEX_NATIONAL_DEALERSHIP_ID, name: APEX_NATIONAL_DEALERSHIP_NAME },
  });

  const group = await prisma.dealerGroup.upsert({
    where: { code: VITI_AUTO_DEALER_GROUP_CODE },
    update: {
      name: 'Viti Automotive Group',
      legalName: 'Viti, Inc.',
      status: 'active',
    },
    create: {
      id: VITI_AUTO_DEALER_GROUP_ID,
      code: VITI_AUTO_DEALER_GROUP_CODE,
      name: 'Viti Automotive Group',
      legalName: 'Viti, Inc.',
      status: 'active',
    },
  });

  const linkedDealerCodes: string[] = [];
  for (const code of VITI_AUTO_DEALER_CODES) {
    const updated = await prisma.dealer.updateMany({
      where: { code },
      data: { dealerGroupId: group.id },
    });
    if (updated.count > 0) linkedDealerCodes.push(code);
  }

  const password = stripEnvQuotes(process.env.VITI_AUTO_OWNER_PASSWORD);
  const usernameRaw =
    stripEnvQuotes(process.env.VITI_AUTO_OWNER_USERNAME) || VITI_AUTO_OWNER_DEFAULT_USERNAME;
  const username = normalizeApexUsername(usernameRaw);
  const email =
    stripEnvQuotes(process.env.VITI_AUTO_OWNER_EMAIL).toLowerCase() || 'james.gray@viti.com';
  const name = stripEnvQuotes(process.env.VITI_AUTO_OWNER_NAME) || 'James Gray';

  if (!password) {
    logger.info('apex.dealer_group_seed', {
      groupCode: group.code,
      linkedDealerCodes,
      ownerSeeded: false,
      reason: 'VITI_AUTO_OWNER_PASSWORD unset',
    });
    return {
      dealerGroupId: group.id,
      dealerGroupCode: group.code,
      linkedDealerCodes,
      ownerId: null,
      ownerUsername: null,
      ownerEmail: null,
      skippedOwner: true,
      skipReason: 'VITI_AUTO_OWNER_PASSWORD unset',
    };
  }

  if (!isApexUsernameCredential(username)) {
    throw new Error(
      `Invalid VITI_AUTO_OWNER_USERNAME "${usernameRaw}" — use brand.firstname.lastname (e.g. viti.james.gray)`
    );
  }

  if (password.length < 8) {
    throw new Error('VITI_AUTO_OWNER_PASSWORD must be at least 8 characters');
  }

  if (isProductionRuntime() && password.length < 12) {
    logger.warn('apex.dealer_group_owner_weak_password', {
      message: 'Production group owner password is shorter than 12 characters',
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Free username if held by another account
  await prisma.technician.updateMany({
    where: {
      apexUsername: username,
      email: { not: email },
    },
    data: { apexUsername: null },
  });

  const existingByEmail = await prisma.technician.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  });

  const ownerData = {
    email,
    name,
    passwordHash,
    role: 'owner' as const,
    isAdmin: true,
    isActive: true,
    deletedAt: null as Date | null,
    d7Number: null as string | null,
    apexUsername: username,
    dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
    dealerId: null as string | null,
    mustChangePassword: false,
    ...seedCompliance,
  };

  const owner = existingByEmail
    ? await prisma.technician.update({
        where: { id: existingByEmail.id },
        data: ownerData,
      })
    : await prisma.technician.create({ data: ownerData });

  await prisma.dealerGroupMembership.upsert({
    where: {
      dealerGroupId_technicianId: {
        dealerGroupId: group.id,
        technicianId: owner.id,
      },
    },
    update: {
      role: 'owner',
      isPrimary: true,
      isActive: true,
    },
    create: {
      dealerGroupId: group.id,
      technicianId: owner.id,
      role: 'owner',
      isPrimary: true,
      isActive: true,
    },
  });

  logger.info('apex.dealer_group_seed', {
    groupCode: group.code,
    linkedDealerCodes,
    ownerId: owner.id,
    ownerUsername: username,
  });

  return {
    dealerGroupId: group.id,
    dealerGroupCode: group.code,
    linkedDealerCodes,
    ownerId: owner.id,
    ownerUsername: username,
    ownerEmail: owner.email,
    skippedOwner: false,
  };
}

/** Idempotent entry used by db:seed / startup. */
export async function runDealerGroupSeedIfConfigured(): Promise<VitiAutoGroupSeedResult | null> {
  try {
    return await seedVitiAutomotiveGroup();
  } catch (error) {
    logger.error('apex.dealer_group_seed_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
