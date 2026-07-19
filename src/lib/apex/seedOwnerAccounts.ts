import 'server-only';

import bcrypt from 'bcryptjs';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';
import { normalizeApexUsername } from '@/lib/apex/credentialType';
import { upsertTechnicianDealershipMembership } from '@/lib/apex/membershipGuard';
import {
  APEX_NATIONAL_DEALERSHIP_ID,
  APEX_NATIONAL_DEALERSHIP_NAME,
} from '@/lib/apex/platformConstants';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';

/** Second rooftop for multi-dealership selector demos and integration tests. */
export const APEX_SEED_SECOND_DEALERSHIP_ID = 'seed-dealership-2';

/** Primary seed pilot rooftop id (no franchise Dealer.code). */
export const APEX_SEED_PRIMARY_DEALERSHIP_ID = 'seed-dealership';

/**
 * Clean team test environments (seed pilots, not provisioned franchise codes).
 * Templates are operational intent — not stored on Dealership rows.
 */
export const APEX_TEST_PLATFORM_ROOFTOP_NAME = 'Staging - Mercedes-Benz Dealers';
/** Operational template for the primary seed rooftop (D7 / Xentry testing). */
export const APEX_TEST_PLATFORM_TEMPLATE_ID = 'mercedes-rooftop-v1' as const;

export const APEX_GENERIC_TEST_ROOFTOP_NAME = 'Apex Generic Test';
/** Operational template for the second seed rooftop (username login, neutral chrome). */
export const APEX_GENERIC_TEST_TEMPLATE_ID = 'generic-rooftop-v1' as const;

const seedCompliance = {
  consentAt: new Date(),
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: new Date(),
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
};

export interface ApexOwnerAccountSeed {
  email: string;
  password: string;
  name: string;
}

export interface ApexOwnerSeedConfig {
  /** One or more national owner accounts (email login only). */
  owners: ApexOwnerAccountSeed[];
  multiRooftopUsername?: string;
  multiRooftopPassword?: string;
  multiRooftopName?: string;
}

/** Strip optional wrapping quotes from dotenv values (Windows shells sometimes re-quote). */
export function stripEnvQuotes(value: string | undefined): string {
  let v = value?.trim() ?? '';
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function pushOwnerIfConfigured(
  owners: ApexOwnerAccountSeed[],
  emailRaw: string | undefined,
  passwordRaw: string | undefined,
  nameRaw: string | undefined,
  fallbackName: string
): void {
  const email = stripEnvQuotes(emailRaw).toLowerCase();
  const password = stripEnvQuotes(passwordRaw);
  if (!email || !password) return;
  if (!email.includes('@')) return;
  if (owners.some((o) => o.email === email)) return;
  owners.push({
    email,
    password,
    name: stripEnvQuotes(nameRaw) || fallbackName,
  });
}

/**
 * Read apex owner + optional multi-rooftop seed credentials.
 * Env only — no hard-coded emails or passwords in source.
 *
 *   OWNER_SEED_EMAIL / OWNER_SEED_PASSWORD / OWNER_SEED_NAME
 *   OWNER_SEED_EMAIL_2 / OWNER_SEED_PASSWORD_2 / OWNER_SEED_NAME_2
 *   MULTI_ROOFTOP_SEED_USERNAME / MULTI_ROOFTOP_SEED_PASSWORD (optional)
 */
export function readApexOwnerSeedConfig(): ApexOwnerSeedConfig | null {
  const owners: ApexOwnerAccountSeed[] = [];

  pushOwnerIfConfigured(
    owners,
    process.env.OWNER_SEED_EMAIL,
    process.env.OWNER_SEED_PASSWORD,
    process.env.OWNER_SEED_NAME,
    'National Owner'
  );
  pushOwnerIfConfigured(
    owners,
    process.env.OWNER_SEED_EMAIL_2,
    process.env.OWNER_SEED_PASSWORD_2,
    process.env.OWNER_SEED_NAME_2,
    'National Owner'
  );

  if (owners.length === 0) return null;

  const multiUsernameRaw = process.env.MULTI_ROOFTOP_SEED_USERNAME?.trim();
  const multiPassword = process.env.MULTI_ROOFTOP_SEED_PASSWORD?.trim();

  return {
    owners,
    ...(multiUsernameRaw && multiPassword
      ? {
          multiRooftopUsername: normalizeApexUsername(multiUsernameRaw),
          multiRooftopPassword: multiPassword,
          multiRooftopName: process.env.MULTI_ROOFTOP_SEED_NAME?.trim() || 'Multi-Rooftop Technician',
        }
      : {}),
  };
}

export interface ApexOwnerSeedResult {
  /** Primary owner email (first seeded) — backward compatible. */
  ownerEmail: string;
  ownerId: string;
  owners: Array<{ email: string; id: string; created: boolean }>;
  multiRooftopUsername?: string;
  multiRooftopId?: string;
  rooftopIds: string[];
}

async function ensureNationalSentinelDealership(): Promise<void> {
  await getRlsDb().dealership.upsert({
    where: { id: APEX_NATIONAL_DEALERSHIP_ID },
    update: { name: APEX_NATIONAL_DEALERSHIP_NAME },
    create: { id: APEX_NATIONAL_DEALERSHIP_ID, name: APEX_NATIONAL_DEALERSHIP_NAME },
  });
}

/**
 * Create-only national owner by email.
 * Existing owners are never password-reset or re-hashed (security: Phase 6.1).
 */
async function ensureNationalOwnerAccount(
  account: ApexOwnerAccountSeed
): Promise<{ id: string; email: string; created: boolean }> {
  const email = account.email.trim().toLowerCase();

  const existing = await getRlsDb().technician.findFirst({
    where: { email: { equals: email } },
    select: { id: true, email: true, role: true },
  });

  if (existing) {
    // Do not touch passwordHash, consent, or credentials. Optionally re-assert owner role
    // only when the account is already an owner and was soft-deactivated incorrectly —
    // still never rewrite password.
    // Seed owners are env long-lived credentials (not temporary provision passwords) —
    // clear forced rotation so integration/CI can exercise owner APIs after db:seed.
    await getRlsDb().technician.update({
      where: { id: existing.id },
      data: {
        ...(existing.role === 'owner' && existing.email !== email ? { email } : {}),
        mustChangePassword: false,
        isActive: true,
        deletedAt: null,
      },
    });
    return { id: existing.id, email: existing.email, created: false };
  }

  const passwordHash = await bcrypt.hash(account.password, 12);
  const created = await getRlsDb().technician.create({
    data: {
      email,
      name: account.name,
      passwordHash,
      role: 'owner',
      isAdmin: true,
      isActive: true,
      d7Number: null,
      apexUsername: null,
      dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
      dealerId: null,
      // Seed credentials are known/env-managed — not one-time provision temps.
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      ...seedCompliance,
    },
  });

  return { id: created.id, email: created.email, created: true };
}

export async function seedApexOwnerAccounts(config: ApexOwnerSeedConfig): Promise<ApexOwnerSeedResult> {
  if (!config.owners?.length) {
    throw new Error('seedApexOwnerAccounts requires at least one owner account');
  }

  return withRlsBypass(async () => seedApexOwnerAccountsInner(config));
}

async function seedApexOwnerAccountsInner(config: ApexOwnerSeedConfig): Promise<ApexOwnerSeedResult> {
  await ensureNationalSentinelDealership();

  // Keep seed pilots as named team test rooftops (re-seed renames if still on old pilot labels).
  const primaryDealership = await getRlsDb().dealership.upsert({
    where: { id: APEX_SEED_PRIMARY_DEALERSHIP_ID },
    update: { name: APEX_TEST_PLATFORM_ROOFTOP_NAME },
    create: {
      id: APEX_SEED_PRIMARY_DEALERSHIP_ID,
      name: APEX_TEST_PLATFORM_ROOFTOP_NAME,
    },
  });

  const secondDealership = await getRlsDb().dealership.upsert({
    where: { id: APEX_SEED_SECOND_DEALERSHIP_ID },
    update: { name: APEX_GENERIC_TEST_ROOFTOP_NAME },
    create: {
      id: APEX_SEED_SECOND_DEALERSHIP_ID,
      name: APEX_GENERIC_TEST_ROOFTOP_NAME,
    },
  });

  const seededOwners: Array<{ email: string; id: string; created: boolean }> = [];
  for (const account of config.owners) {
    const owner = await ensureNationalOwnerAccount(account);
    seededOwners.push(owner);
  }

  let multiRooftopId: string | undefined;
  let multiRooftopUsername: string | undefined;

  if (config.multiRooftopUsername && config.multiRooftopPassword) {
    multiRooftopUsername = config.multiRooftopUsername;
    const multiEmail = `multi-rooftop+${config.multiRooftopUsername}@apex.seed.local`;

    const existingMulti = await getRlsDb().technician.findUnique({
      where: { email: multiEmail },
      select: { id: true },
    });

    if (existingMulti) {
      // Create-only: never reset multi-rooftop password hash.
      multiRooftopId = existingMulti.id;
      await getRlsDb().technician.update({
        where: { id: existingMulti.id },
        data: {
          apexUsername: config.multiRooftopUsername,
          name: config.multiRooftopName ?? 'Multi-Rooftop Technician',
          role: 'technician',
          isAdmin: false,
          isActive: true,
          deletedAt: null,
          d7Number: null,
          dealershipId: primaryDealership.id,
          mustChangePassword: false,
        },
      });
    } else {
      await getRlsDb().technician.updateMany({
        where: {
          apexUsername: config.multiRooftopUsername,
          email: { not: multiEmail },
        },
        data: { apexUsername: null, isActive: false, deletedAt: new Date() },
      });

      const multiHash = await bcrypt.hash(config.multiRooftopPassword, 12);
      const multi = await getRlsDb().technician.create({
        data: {
          email: multiEmail,
          apexUsername: config.multiRooftopUsername,
          name: config.multiRooftopName ?? 'Multi-Rooftop Technician',
          passwordHash: multiHash,
          role: 'technician',
          isAdmin: false,
          isActive: true,
          d7Number: null,
          dealershipId: primaryDealership.id,
          // Seed multi-rooftop account — ready for selector flows without forced rotation.
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          ...seedCompliance,
        },
      });
      multiRooftopId = multi.id;
    }

    await upsertTechnicianDealershipMembership({
      technicianId: multiRooftopId,
      dealershipId: primaryDealership.id,
      role: 'technician',
      isPrimary: true,
      isActive: true,
    });
    await upsertTechnicianDealershipMembership({
      technicianId: multiRooftopId,
      dealershipId: secondDealership.id,
      role: 'technician',
      isPrimary: false,
      isActive: true,
    });
  }

  const primary = seededOwners[0]!;
  return {
    ownerEmail: primary.email,
    ownerId: primary.id,
    owners: seededOwners,
    multiRooftopUsername,
    multiRooftopId,
    rooftopIds: [primaryDealership.id, secondDealership.id],
  };
}

/** Idempotent apex owner seed — create missing owners only; no-op when env incomplete. */
export async function runApexOwnerSeedIfConfigured(): Promise<ApexOwnerSeedResult | null> {
  const config = readApexOwnerSeedConfig();
  if (!config) return null;
  return seedApexOwnerAccounts(config);
}

/**
 * Ensure platform owners from env exist (create-only).
 * Never rewrites passwords. Safe for instrumentation startup.
 * Must NOT be called from login failure paths to "heal" wrong passwords.
 *
 * P0 ops: OWNER_SEED_* secrets are one-time bootstrap only. After owners exist,
 * remove OWNER_SEED_PASSWORD (and related) from the Cloudflare Worker secrets store.
 */
export async function ensureApexPlatformOwners(): Promise<ApexOwnerSeedResult | null> {
  try {
    if (process.env.OWNER_SEED_PASSWORD?.trim() && process.env.NODE_ENV === 'production') {
      const { logger } = await import('@/lib/logger');
      logger.warn('apex.owner_seed_secret_still_set', {
        message:
          'OWNER_SEED_PASSWORD is set in production — delete seed secrets from Worker after bootstrap (one-time use only).',
      });
    }
    const result = await runApexOwnerSeedIfConfigured();
    if (result) {
      const created = result.owners.filter((o) => o.created).map((o) => o.email);
      const existing = result.owners.filter((o) => !o.created).map((o) => o.email);
      logger.info('apex.owner_seed_ensured', {
        createdCount: created.length,
        existingCount: existing.length,
        // emails are operational identities for owners — avoid logging full lists in production noise
        created: created.length,
        skippedExisting: existing.length,
      });
    }
    return result;
  } catch (error) {
    logger.error('apex.owner_seed_ensure_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
