import 'server-only';

import { createHash, createHmac, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import {
  assertTemplateHasNoHardcodedIdentity,
  getDealerTemplate,
  type DealerTemplate,
  type DealerTemplateId,
} from '@/lib/apex/dealerTemplates';
import {
  APEX_NATIONAL_DEALERSHIP_ID,
  APEX_NATIONAL_DEALERSHIP_NAME,
} from '@/lib/apex/platformConstants';
import { withRlsBypass } from '@/lib/apex/rlsContext';
import { isValidD7Number, normalizeD7Number } from '@/lib/d7Number';
import { isApexUsernameCredential, normalizeApexUsername, normalizeEmailIdentifier } from '@/lib/apex/credentialType';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ensureDealershipModuleDefaults } from '@/lib/modules/entitlements';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';
import { storyBrandFromTemplateBrand } from '@/lib/storyBrand/resolveStoryBrand';

/** Rooftops that must never be provision targets. */
export const PROVISION_DENY_DEALERSHIP_IDS = new Set([
  'seed-dealership',
  'seed-dealership-2',
  APEX_NATIONAL_DEALERSHIP_ID,
]);

const RESERVED_DEALER_CODES = new Set(['NATIONAL', 'MERLINUS', 'SEED', 'TIVERTON', 'APEX', 'ADMIN', 'TEST', 'VITI']);

/** Pilot / placeholder labels that must never be used as provisioned display names. */
const FORBIDDEN_ROOFTOP_NAME_SNIPPETS = [
  'merlinus',
  'seed-dealership',
  'placeholder',
  'todo',
  'test dealership',
  'example dealership',
];

/** Exact pilot names that must never be re-used as franchise or rooftop labels. */
const FORBIDDEN_EXACT_DISPLAY_NAMES = new Set([
  'mercedes-benz of tiverton',
  'tiverton',
  'merlinus',
  'viti',
]);

export type ProvisionIfExists = 'fail' | 'skip' | 'update-metadata';

export interface ProvisionDealerActor {
  type: 'script' | 'owner_api';
  id: string;
}

export interface ProvisionManagerInput {
  name: string;
  email: string;
  /** Plain password — never logged; caller must not pass via argv. */
  password: string;
  d7Number?: string | null;
  apexUsername?: string | null;
}

/** Optional dealership owner — email login + DealerGroup membership for dashboard access. */
export interface ProvisionOwnerInput {
  name: string;
  email: string;
  /** Plain password for new owners — never logged; ignored when linking an existing owner. */
  password: string;
}

export interface ProvisionDealerInput {
  dealerCode: string;
  dealerName: string;
  /** Full storefront name shown in UI (e.g. "Mercedes-Benz of Newport"). */
  rooftopName: string;
  templateId: string;
  manager: ProvisionManagerInput;
  /**
   * Optional owner path. When set, creates (or links) an owner technician and a
   * DealerGroup + membership so the owner can enter this rooftop without waiting
   * for the manager to grant access later. Manager remains the primary D7 login.
   */
  owner?: ProvisionOwnerInput | null;
  ifExists?: ProvisionIfExists;
  dryRun?: boolean;
  actor: ProvisionDealerActor;
}

export interface ProvisionDealerLoginHint {
  role: 'manager' | 'owner';
  identifierType: 'd7' | 'email' | 'username';
  /** Present only when caller opts into credential reveal (CLI --show-credentials). */
  identifier?: string;
}

export interface ProvisionDealerResult {
  created: boolean;
  skipped: boolean;
  dryRun: boolean;
  dealerId: string;
  dealershipId: string;
  managerId: string;
  /** Owner technician id when owner path ran; null when omitted or skip paths. */
  ownerId: string | null;
  /** DealerGroup created/used for owner membership; null when owner omitted. */
  dealerGroupId: string | null;
  /** True when a new owner account was created (temp password applies). */
  ownerCreated: boolean;
  /** True when an existing owner account was linked to this dealer group. */
  ownerLinked: boolean;
  templateId: DealerTemplateId;
  /** Full rooftop display name as stored (UI header / national list). */
  rooftopName: string;
  dealerCode: string;
  auditLogId: string | null;
  mustChangePassword: true;
  logins: ProvisionDealerLoginHint[];
}

export class ProvisionDealerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ProvisionDealerError';
    this.code = code;
  }
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export function normalizeDealerCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function validateRooftopDisplayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 5 || trimmed.length > 120) {
    throw new ProvisionDealerError(
      'INVALID_ROOFTOP_NAME',
      'Rooftop name must be 5–120 characters (e.g. "Mercedes-Benz of Newport").'
    );
  }
  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_EXACT_DISPLAY_NAMES.has(lower)) {
    throw new ProvisionDealerError(
      'FORBIDDEN_ROOFTOP_NAME',
      'Rooftop name must not reuse the Merlinus pilot storefront label — pass the new storefront name.'
    );
  }
  for (const snippet of FORBIDDEN_ROOFTOP_NAME_SNIPPETS) {
    if (lower.includes(snippet)) {
      throw new ProvisionDealerError(
        'FORBIDDEN_ROOFTOP_NAME',
        `Rooftop name must not contain placeholder or legacy labels (${snippet}).`
      );
    }
  }
  if (lower === 'tiverton') {
    throw new ProvisionDealerError(
      'FORBIDDEN_ROOFTOP_NAME',
      'Rooftop name must be the full storefront name, not a bare city placeholder.'
    );
  }
  return trimmed;
}

export function validateDealerName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 3 || trimmed.length > 120) {
    throw new ProvisionDealerError('INVALID_DEALER_NAME', 'Dealer (franchise) name must be 3–120 characters.');
  }
  const lower = trimmed.toLowerCase();
  if (FORBIDDEN_EXACT_DISPLAY_NAMES.has(lower)) {
    throw new ProvisionDealerError(
      'FORBIDDEN_DEALER_NAME',
      'Dealer name must not reuse the Merlinus pilot label — pass the franchise name from provisioning.'
    );
  }
  if (lower.includes('merlinus') || lower.includes('seed-dealership')) {
    throw new ProvisionDealerError(
      'FORBIDDEN_DEALER_NAME',
      'Dealer name must not contain pilot/placeholder labels.'
    );
  }
  return trimmed;
}

/**
 * Resolve display names strictly from provision input — templates never contribute names.
 * Returns the validated pair written to Dealer.name / Dealership.name.
 */
export function resolveProvisionDisplayNames(input: {
  dealerName: string;
  rooftopName: string;
  template: DealerTemplate;
}): { dealerName: string; rooftopName: string } {
  assertTemplateHasNoHardcodedIdentity(input.template);
  return {
    dealerName: validateDealerName(input.dealerName),
    rooftopName: validateRooftopDisplayName(input.rooftopName),
  };
}

function getAuditHmacKey(): string {
  return (
    process.env.PROVISION_AUDIT_HMAC_KEY?.trim() ||
    process.env.SEARCH_HMAC_KEY?.trim() ||
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    ''
  );
}

/** Non-reversible dealer code token for audit metadata (no plain code in audit). */
export function hashDealerCodeForAudit(dealerCode: string): string {
  const key = getAuditHmacKey();
  const normalized = normalizeDealerCode(dealerCode);
  if (key.length >= 32) {
    return createHmac('sha256', key).update(`apex-provision-dealer-code:${normalized}`).digest('hex');
  }
  return createHash('sha256').update(`apex-provision-dealer-code:${normalized}`).digest('hex');
}

/** Strict allow-list — used by tests and before writeAuditedAccess. */
export const DEALER_PROVISION_METADATA_ALLOWED_KEYS = new Set([
  'templateId',
  'brand',
  'dealerCodeHash',
  'dealerId',
  'dealershipId',
  'managerTechnicianId',
  'ownerTechnicianId',
  'dealerGroupId',
  'ownerOutcome',
  'loginStrategy',
  'actorType',
  'actorIdHash',
  'ifExistsMode',
  'schemaVersion',
  'outcome',
]);

export function buildDealerProvisionAuditMetadata(input: {
  template: DealerTemplate;
  dealerCode: string;
  dealerId: string;
  dealershipId: string;
  managerTechnicianId: string;
  ownerTechnicianId?: string | null;
  dealerGroupId?: string | null;
  ownerOutcome?: 'created' | 'linked' | 'none';
  actor: ProvisionDealerActor;
  ifExistsMode: ProvisionIfExists;
  outcome: 'created' | 'updated_metadata';
}): Record<string, string | number | boolean> {
  const actorIdHash = createHash('sha256').update(`actor:${input.actor.type}:${input.actor.id}`).digest('hex');
  const meta: Record<string, string | number | boolean> = {
    templateId: input.template.id,
    brand: input.template.brand,
    dealerCodeHash: hashDealerCodeForAudit(input.dealerCode),
    dealerId: input.dealerId,
    dealershipId: input.dealershipId,
    managerTechnicianId: input.managerTechnicianId,
    loginStrategy: input.template.loginStrategy,
    actorType: input.actor.type,
    actorIdHash,
    ifExistsMode: input.ifExistsMode,
    schemaVersion: 1,
    outcome: input.outcome,
  };
  if (input.ownerTechnicianId) {
    meta.ownerTechnicianId = input.ownerTechnicianId;
  }
  if (input.dealerGroupId) {
    meta.dealerGroupId = input.dealerGroupId;
  }
  if (input.ownerOutcome && input.ownerOutcome !== 'none') {
    meta.ownerOutcome = input.ownerOutcome;
  }
  for (const key of Object.keys(meta)) {
    if (!DEALER_PROVISION_METADATA_ALLOWED_KEYS.has(key)) {
      throw new ProvisionDealerError('AUDIT_METADATA_VIOLATION', `Forbidden audit key: ${key}`);
    }
  }
  return meta;
}

function assertPasswordPolicy(password: string, subject: 'Manager' | 'Owner' = 'Manager'): void {
  // Align with changePasswordSchema (min 8); operators may set short temp passwords for first login.
  if (password.length < 8) {
    throw new ProvisionDealerError('WEAK_PASSWORD', `${subject} password must be at least 8 characters.`);
  }
  if (password.length > 128) {
    throw new ProvisionDealerError('WEAK_PASSWORD', `${subject} password is too long.`);
  }
  const lower = password.toLowerCase();
  const weak = ['password', 'changeme', 'dealer123', 'mercedes', 'password123', '123456789012'];
  if (weak.some((w) => lower.includes(w))) {
    throw new ProvisionDealerError('WEAK_PASSWORD', `${subject} password is too weak.`);
  }
}

function validateManagerForTemplate(template: DealerTemplate, manager: ProvisionManagerInput): {
  email: string;
  name: string;
  d7Number: string | null;
  apexUsername: string | null;
} {
  const name = manager.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw new ProvisionDealerError('INVALID_MANAGER_NAME', 'Manager name must be 2–80 characters.');
  }
  const email = normalizeEmailIdentifier(manager.email);
  if (!email.includes('@') || email.length > 254) {
    throw new ProvisionDealerError('INVALID_MANAGER_EMAIL', 'Manager email is invalid.');
  }
  assertPasswordPolicy(manager.password);

  let d7Number: string | null = null;
  let apexUsername: string | null = null;

  if (template.loginStrategy === 'd7') {
    if (!manager.d7Number?.trim()) {
      throw new ProvisionDealerError('MANAGER_D7_REQUIRED', 'Mercedes template requires --manager-d7.');
    }
    d7Number = normalizeD7Number(manager.d7Number);
    if (!isValidD7Number(d7Number)) {
      throw new ProvisionDealerError('INVALID_MANAGER_D7', 'Manager D7 is invalid (e.g. D7NEWPORT1).');
    }
  } else if (template.loginStrategy === 'apex_username') {
    if (!manager.apexUsername?.trim()) {
      throw new ProvisionDealerError(
        'MANAGER_USERNAME_REQUIRED',
        'Generic template requires --manager-username (brand.firstname.lastname).'
      );
    }
    apexUsername = normalizeApexUsername(manager.apexUsername);
    if (!isApexUsernameCredential(apexUsername)) {
      throw new ProvisionDealerError(
        'INVALID_MANAGER_USERNAME',
        'Manager username must look like brand.firstname.lastname.'
      );
    }
  }
  // base-rooftop-v1 (email): manager signs in with email only — no D7 / apex username required.

  return { email, name, d7Number, apexUsername };
}

function validateOwnerInput(
  owner: ProvisionOwnerInput,
  managerEmail: string
): { email: string; name: string } {
  const name = owner.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    throw new ProvisionDealerError('INVALID_OWNER_NAME', 'Owner name must be 2–80 characters.');
  }
  const email = normalizeEmailIdentifier(owner.email);
  if (!email.includes('@') || email.length > 254) {
    throw new ProvisionDealerError('INVALID_OWNER_EMAIL', 'Owner email is invalid.');
  }
  if (email === managerEmail) {
    throw new ProvisionDealerError(
      'OWNER_EMAIL_SAME_AS_MANAGER',
      'Owner email must be different from the service manager email.'
    );
  }
  assertPasswordPolicy(owner.password, 'Owner');
  return { email, name };
}

async function countProvisionsToday(tx: Prisma.TransactionClient): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return tx.auditLog.count({
    where: {
      action: 'dealer.provision',
      createdAt: { gte: start },
    },
  });
}

function getMaxProvisionsPerDay(): number {
  const raw = process.env.APEX_MAX_PROVISIONS_PER_DAY?.trim();
  const n = raw ? Number(raw) : 20;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

function getMaxDealerships(): number {
  const raw = process.env.APEX_MAX_DEALERSHIPS?.trim();
  const n = raw ? Number(raw) : 500;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 500;
}

/**
 * Provision a franchise Dealer + rooftop Dealership + service manager.
 * Optionally creates/links a dealership owner with DealerGroup membership (parallel path).
 * Security: password never logged; audit metadata has zero PII; RLS bypass is transaction-local.
 */
export async function provisionDealer(input: ProvisionDealerInput): Promise<ProvisionDealerResult> {
  const template = getDealerTemplate(input.templateId);
  if (!template) {
    throw new ProvisionDealerError('UNKNOWN_TEMPLATE', `Unknown template "${input.templateId}".`);
  }

  const dealerCode = normalizeDealerCode(input.dealerCode);
  if (dealerCode.length < 2 || dealerCode.length > 32) {
    throw new ProvisionDealerError('INVALID_DEALER_CODE', 'Dealer code must be 2–32 chars [A-Z0-9_-].');
  }
  if (RESERVED_DEALER_CODES.has(dealerCode)) {
    throw new ProvisionDealerError('RESERVED_DEALER_CODE', `Dealer code "${dealerCode}" is reserved.`);
  }

  // Names always from provision input — template branding never supplies storefront/pilot labels.
  const { dealerName, rooftopName } = resolveProvisionDisplayNames({
    dealerName: input.dealerName,
    rooftopName: input.rooftopName,
    template,
  });
  if (rooftopName.toUpperCase() === dealerCode) {
    throw new ProvisionDealerError(
      'INVALID_ROOFTOP_NAME',
      'Rooftop display name must be the full storefront name, not only the dealer code.'
    );
  }

  const managerNorm = validateManagerForTemplate(template, input.manager);
  const ownerNorm = input.owner ? validateOwnerInput(input.owner, managerNorm.email) : null;
  const ifExists = input.ifExists ?? 'fail';
  const dryRun = Boolean(input.dryRun);

  const managerLoginType: ProvisionDealerLoginHint['identifierType'] =
    template.loginStrategy === 'd7'
      ? 'd7'
      : template.loginStrategy === 'apex_username'
        ? 'username'
        : 'email';

  if (dryRun) {
    const logins: ProvisionDealerLoginHint[] = [
      { role: 'manager', identifierType: managerLoginType },
    ];
    if (ownerNorm) {
      logins.push({ role: 'owner', identifierType: 'email' });
    }
    return {
      created: false,
      skipped: false,
      dryRun: true,
      dealerId: 'dry-run',
      dealershipId: 'dry-run',
      managerId: 'dry-run',
      ownerId: ownerNorm ? 'dry-run' : null,
      dealerGroupId: ownerNorm ? 'dry-run' : null,
      ownerCreated: Boolean(ownerNorm),
      ownerLinked: false,
      templateId: template.id,
      rooftopName,
      dealerCode,
      auditLogId: null,
      mustChangePassword: true,
      logins,
    };
  }

  return withRlsBypass(async (tx) => {
    const provisionsToday = await countProvisionsToday(tx);
    if (provisionsToday >= getMaxProvisionsPerDay()) {
      throw new ProvisionDealerError(
        'PROVISION_DAILY_CAP',
        `Daily provision cap reached (${getMaxProvisionsPerDay()}).`
      );
    }

    const dealershipCount = await tx.dealership.count({
      where: { id: { notIn: [...PROVISION_DENY_DEALERSHIP_IDS] } },
    });
    if (dealershipCount >= getMaxDealerships()) {
      throw new ProvisionDealerError('PROVISION_MAX_DEALERSHIPS', 'Platform dealership cap reached.');
    }

    const existingDealer = await tx.dealer.findUnique({ where: { code: dealerCode } });
    if (existingDealer) {
      if (ifExists === 'skip') {
        const rooftop = await tx.dealership.findFirst({
          where: { dealerId: existingDealer.id },
          orderBy: { createdAt: 'asc' },
        });
        return {
          created: false,
          skipped: true,
          dryRun: false,
          dealerId: existingDealer.id,
          dealershipId: rooftop?.id ?? '',
          managerId: '',
          ownerId: null,
          dealerGroupId: existingDealer.dealerGroupId ?? null,
          ownerCreated: false,
          ownerLinked: false,
          templateId: template.id,
          rooftopName: rooftop?.name ?? rooftopName,
          dealerCode,
          auditLogId: null,
          mustChangePassword: true,
          logins: [],
        };
      }
      if (ifExists === 'fail') {
        throw new ProvisionDealerError('DEALER_EXISTS', `Dealer code "${dealerCode}" already exists.`);
      }
      // update-metadata: only rename dealer display; never touch rooftop PII users here without explicit ids
      await tx.dealer.update({
        where: { id: existingDealer.id },
        data: { name: dealerName },
      });
      const rooftop = await tx.dealership.findFirst({
        where: { dealerId: existingDealer.id },
        orderBy: { createdAt: 'asc' },
      });
      if (rooftop && !PROVISION_DENY_DEALERSHIP_IDS.has(rooftop.id)) {
        await tx.dealership.update({
          where: { id: rooftop.id },
          data: { name: rooftopName },
        });
      }
      const meta = buildDealerProvisionAuditMetadata({
        template,
        dealerCode,
        dealerId: existingDealer.id,
        dealershipId: rooftop?.id ?? existingDealer.id,
        managerTechnicianId: 'n/a',
        ownerOutcome: 'none',
        actor: input.actor,
        ifExistsMode: 'update-metadata',
        outcome: 'updated_metadata',
      });
      const auditLogId = await writeAuditedAccess(
        {
          action: 'dealer.provision',
          dealershipId: rooftop?.id ?? APEX_NATIONAL_DEALERSHIP_ID,
          dealerId: existingDealer.id,
          entityType: 'dealer',
          entityId: existingDealer.id,
          metadata: meta,
        },
        { tx }
      );
      return {
        created: false,
        skipped: false,
        dryRun: false,
        dealerId: existingDealer.id,
        dealershipId: rooftop?.id ?? '',
        managerId: '',
        ownerId: null,
        dealerGroupId: existingDealer.dealerGroupId ?? null,
        ownerCreated: false,
        ownerLinked: false,
        templateId: template.id,
        rooftopName,
        dealerCode,
        auditLogId,
        mustChangePassword: true,
        logins: [],
      };
    }

    // Uniqueness of manager identity
    const emailTaken = await tx.technician.findFirst({
      where: { email: { equals: managerNorm.email } },
      select: { id: true },
    });
    if (emailTaken) {
      throw new ProvisionDealerError('MANAGER_EMAIL_EXISTS', 'Manager email is already in use.');
    }
    if (managerNorm.d7Number) {
      const d7Taken = await tx.technician.findUnique({
        where: { d7Number: managerNorm.d7Number },
        select: { id: true },
      });
      if (d7Taken) {
        throw new ProvisionDealerError('MANAGER_D7_EXISTS', 'Manager D7 is already in use.');
      }
    }
    if (managerNorm.apexUsername) {
      const userTaken = await tx.technician.findUnique({
        where: { apexUsername: managerNorm.apexUsername },
        select: { id: true },
      });
      if (userTaken) {
        throw new ProvisionDealerError('MANAGER_USERNAME_EXISTS', 'Manager username is already in use.');
      }
    }

    // Resolve optional owner before writes (create vs link).
    let ownerId: string | null = null;
    let ownerCreated = false;
    let ownerLinked = false;
    let existingOwnerForLink: { id: string; role: string } | null = null;
    if (ownerNorm) {
      const existingOwner = await tx.technician.findFirst({
        where: { email: { equals: ownerNorm.email } },
        select: { id: true, role: true },
      });
      if (existingOwner) {
        if (existingOwner.role !== 'owner') {
          throw new ProvisionDealerError(
            'OWNER_EMAIL_CONFLICT',
            'Owner email is already in use by a non-owner account.'
          );
        }
        existingOwnerForLink = existingOwner;
        ownerLinked = true;
      }
    }

    // DealerGroup for owner portfolio (only when owner path is active).
    let dealerGroupId: string | null = null;
    if (ownerNorm) {
      const groupCodeTaken = await tx.dealerGroup.findUnique({
        where: { code: dealerCode },
        select: { id: true },
      });
      if (groupCodeTaken) {
        throw new ProvisionDealerError(
          'DEALER_GROUP_EXISTS',
          `A dealer group with code "${dealerCode}" already exists.`
        );
      }
    }

    const passwordHash = await bcrypt.hash(input.manager.password, 12);
    // Reduce lifetime of plaintext in this closure (best-effort)
    (input.manager as { password: string }).password = '';

    let ownerPasswordHash: string | null = null;
    if (ownerNorm && !ownerLinked && input.owner) {
      ownerPasswordHash = await bcrypt.hash(input.owner.password, 12);
      (input.owner as { password: string }).password = '';
    } else if (input.owner) {
      (input.owner as { password: string }).password = '';
    }

    if (ownerNorm) {
      const dealerGroup = await tx.dealerGroup.create({
        data: {
          code: dealerCode,
          name: dealerName,
          legalName: dealerName,
          status: 'active',
        },
      });
      dealerGroupId = dealerGroup.id;
    }

    const dealer = await tx.dealer.create({
      data: {
        code: dealerCode,
        name: dealerName,
        status: 'active',
        ...(dealerGroupId ? { dealerGroupId } : {}),
      },
    });

    const dealership = await tx.dealership.create({
      data: {
        name: rooftopName,
        dealerId: dealer.id,
        storyBrand: storyBrandFromTemplateBrand(template.brand),
      },
    });

    if (PROVISION_DENY_DEALERSHIP_IDS.has(dealership.id)) {
      throw new ProvisionDealerError('DENY_LIST', 'Generated dealership id is reserved — aborting.');
    }

    const manager = await tx.technician.create({
      data: {
        email: managerNorm.email,
        name: managerNorm.name,
        passwordHash,
        role: 'manager',
        isAdmin: true,
        isActive: true,
        d7Number: managerNorm.d7Number,
        apexUsername: managerNorm.apexUsername,
        dealershipId: dealership.id,
        dealerId: dealer.id,
        mustChangePassword: true,
        passwordChangedAt: null,
        consentAt: new Date(),
        consentVersion: CONSENT_VERSION,
        legalDisclaimerAt: new Date(),
        legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
      },
    });

    // Membership in the same transaction (do not use global prisma helper).
    await tx.technicianDealership.create({
      data: {
        technicianId: manager.id,
        dealershipId: dealership.id,
        role: 'manager',
        isPrimary: true,
        isActive: true,
      },
    });

    // Parallel owner path: national-sentinel technician + DealerGroup membership.
    if (ownerNorm && dealerGroupId) {
      // Ensure national sentinel exists for owner FK (idempotent).
      await tx.dealership.upsert({
        where: { id: APEX_NATIONAL_DEALERSHIP_ID },
        update: { name: APEX_NATIONAL_DEALERSHIP_NAME },
        create: {
          id: APEX_NATIONAL_DEALERSHIP_ID,
          name: APEX_NATIONAL_DEALERSHIP_NAME,
        },
      });

      if (existingOwnerForLink) {
        ownerId = existingOwnerForLink.id;
        await tx.technician.update({
          where: { id: existingOwnerForLink.id },
          data: {
            isActive: true,
            deletedAt: null,
            // Keep existing credentials; re-assert owner role if needed.
            role: 'owner',
            isAdmin: true,
            dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
          },
        });
      } else {
        if (!ownerPasswordHash) {
          throw new ProvisionDealerError('WEAK_PASSWORD', 'Owner password is required for new accounts.');
        }
        const owner = await tx.technician.create({
          data: {
            email: ownerNorm.email,
            name: ownerNorm.name,
            passwordHash: ownerPasswordHash,
            role: 'owner',
            isAdmin: true,
            isActive: true,
            d7Number: null,
            apexUsername: null,
            dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
            dealerId: null,
            mustChangePassword: true,
            passwordChangedAt: null,
            consentAt: new Date(),
            consentVersion: CONSENT_VERSION,
            legalDisclaimerAt: new Date(),
            legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
          },
        });
        ownerId = owner.id;
        ownerCreated = true;
      }

      await tx.dealerGroupMembership.create({
        data: {
          dealerGroupId,
          technicianId: ownerId,
          role: 'owner',
          isPrimary: true,
          isActive: true,
        },
      });
    }

    // Product modules: enable shippable modules; leave cdk_sync off until credentials.
    await ensureDealershipModuleDefaults(dealership.id, {
      db: tx,
      enabledById: manager.id,
    });

    const ownerOutcome: 'created' | 'linked' | 'none' = ownerCreated
      ? 'created'
      : ownerLinked
        ? 'linked'
        : 'none';

    const meta = buildDealerProvisionAuditMetadata({
      template,
      dealerCode,
      dealerId: dealer.id,
      dealershipId: dealership.id,
      managerTechnicianId: manager.id,
      ownerTechnicianId: ownerId,
      dealerGroupId,
      ownerOutcome,
      actor: input.actor,
      ifExistsMode: ifExists,
      outcome: 'created',
    });

    const auditLogId = await writeAuditedAccess(
      {
        action: 'dealer.provision',
        dealershipId: dealership.id,
        dealerId: dealer.id,
        entityType: 'dealer',
        entityId: dealer.id,
        metadata: meta,
      },
      { tx }
    );

    logger.info('apex.dealer_provisioned', {
      dealerId: dealer.id,
      dealershipId: dealership.id,
      templateId: template.id,
      dealerCodeHash: meta.dealerCodeHash,
      ownerOutcome,
      hasDealerGroup: Boolean(dealerGroupId),
    });

    const logins: ProvisionDealerLoginHint[] = [
      { role: 'manager', identifierType: managerLoginType },
    ];
    if (ownerNorm) {
      logins.push({ role: 'owner', identifierType: 'email' });
    }

    return {
      created: true,
      skipped: false,
      dryRun: false,
      dealerId: dealer.id,
      dealershipId: dealership.id,
      managerId: manager.id,
      ownerId,
      dealerGroupId,
      ownerCreated,
      ownerLinked,
      templateId: template.id,
      rooftopName: dealership.name,
      dealerCode,
      auditLogId,
      mustChangePassword: true,
      logins,
    };
  });
}

/** Generate a CSPRNG temporary password (use with --show-credentials only). */
export function generateProvisionPassword(length = 20): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function assertNotProductionWithoutProvisionUrl(): void {
  if (!isProductionRuntime()) return;
  if (!process.env.PROVISION_DATABASE_URL?.trim() && process.env.APEX_PROVISION_ALLOW_APP_DB !== '1') {
    throw new ProvisionDealerError(
      'PROVISION_DB_REQUIRED',
      'Production provision requires PROVISION_DATABASE_URL (narrow role) or APEX_PROVISION_ALLOW_APP_DB=1 break-glass.'
    );
  }
}

/**
 * HTTP provision is opt-in only. CLI is always available to operators with DB access.
 * Requires exact truthy string "true" (not 1/yes) so mis-set envs stay closed.
 */
export function isHttpProvisionEnabled(): boolean {
  return process.env.APEX_ALLOW_HTTP_PROVISION?.trim() === 'true';
}

/** Map provision engine errors to HTTP status (no secrets in messages). */
export function httpStatusForProvisionError(code: string): number {
  switch (code) {
    case 'PROVISION_DAILY_CAP':
      return 429;
    case 'PROVISION_MAX_DEALERSHIPS':
    case 'PROVISION_DB_REQUIRED':
      return 503;
    case 'MANAGER_EMAIL_EXISTS':
    case 'MANAGER_D7_EXISTS':
    case 'MANAGER_USERNAME_EXISTS':
    case 'OWNER_EMAIL_CONFLICT':
    case 'DEALER_EXISTS':
    case 'DEALER_GROUP_EXISTS':
      return 409;
    case 'UNKNOWN_TEMPLATE':
    case 'INVALID_DEALER_CODE':
    case 'RESERVED_DEALER_CODE':
    case 'INVALID_DEALER_NAME':
    case 'FORBIDDEN_DEALER_NAME':
    case 'INVALID_ROOFTOP_NAME':
    case 'FORBIDDEN_ROOFTOP_NAME':
    case 'INVALID_MANAGER_NAME':
    case 'INVALID_MANAGER_EMAIL':
    case 'INVALID_MANAGER_D7':
    case 'INVALID_MANAGER_USERNAME':
    case 'INVALID_OWNER_NAME':
    case 'INVALID_OWNER_EMAIL':
    case 'OWNER_EMAIL_SAME_AS_MANAGER':
    case 'MANAGER_D7_REQUIRED':
    case 'MANAGER_USERNAME_REQUIRED':
    case 'WEAK_PASSWORD':
    case 'CONFIRM_MISMATCH':
    case 'HTTP_PROVISION_DISABLED':
      return 400;
    default:
      return 400;
  }
}

/**
 * Safe JSON body for HTTP clients — never includes passwords or optional PII identifiers
 * unless caller explicitly builds them separately.
 */
export function toSafeProvisionHttpResponse(result: ProvisionDealerResult): {
  created: boolean;
  skipped: boolean;
  dryRun: boolean;
  dealerId: string;
  dealershipId: string;
  managerId: string;
  ownerId: string | null;
  dealerGroupId: string | null;
  ownerCreated: boolean;
  ownerLinked: boolean;
  templateId: DealerTemplateId;
  rooftopName: string;
  dealerCode: string;
  auditLogId: string | null;
  mustChangePassword: true;
  logins: Array<{ role: 'manager' | 'owner'; identifierType: 'd7' | 'email' | 'username' }>;
} {
  return {
    created: result.created,
    skipped: result.skipped,
    dryRun: result.dryRun,
    dealerId: result.dealerId,
    dealershipId: result.dealershipId,
    managerId: result.managerId,
    ownerId: result.ownerId,
    dealerGroupId: result.dealerGroupId,
    ownerCreated: result.ownerCreated,
    ownerLinked: result.ownerLinked,
    templateId: result.templateId,
    rooftopName: result.rooftopName,
    dealerCode: result.dealerCode,
    auditLogId: result.auditLogId,
    mustChangePassword: true,
    logins: result.logins.map((l) => ({
      role: l.role,
      identifierType: l.identifierType,
    })),
  };
}
