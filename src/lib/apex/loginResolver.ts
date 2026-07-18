import 'server-only';

import type { Prisma, Technician } from '@prisma/client';
import {
  buildSessionPayloadFromTechnician,
  type SessionPayload,
  type TechnicianForSession,
  verifyPassword,
} from '@/lib/auth';
import {
  detectCredentialType,
  isCredentialRoleAllowed,
  normalizeCredentialIdentifier,
  type CredentialType,
} from '@/lib/apex/credentialType';
import { buildOwnerHomeSession } from '@/lib/apex/ownerDealershipContext';
import { listActiveDealershipMemberships } from '@/lib/apex/membershipGuard';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { isTechnicianAccountActive } from '@/lib/technicianAccounts';

export const LEGACY_LOGIN_FAILURE_MESSAGE = 'Invalid D7 number or password.';

type TechnicianWithDealership = Prisma.TechnicianGetPayload<{
  include: { dealership: true };
}>;

export interface LoginDealershipOption {
  id: string;
  name: string;
  dealerCode: string | null;
  isPrimary: boolean;
}

export type UnifiedLoginResult =
  | {
      status: 'success';
      session: SessionPayload;
      credentialType: Exclude<CredentialType, 'invalid'>;
    }
  | {
      status: 'select_dealership';
      technicianId: string;
      sessionVersion: number;
      credentialType: Exclude<CredentialType, 'invalid'>;
      dealerships: LoginDealershipOption[];
    }
  | { status: 'invalid' };

const technicianInclude = { dealership: true } as const;

async function findTechnicianByCredential(
  credentialType: Exclude<CredentialType, 'invalid'>,
  normalizedIdentifier: string
): Promise<TechnicianWithDealership | null> {
  const db = getRlsDb();
  switch (credentialType) {
    case 'email': {
      // Prefer exact lowercase match (owners are seeded lowercased); fall back insensitive.
      const exact = await db.technician.findUnique({
        where: { email: normalizedIdentifier },
        include: technicianInclude,
      });
      if (exact) return exact;
      return db.technician.findFirst({
        where: { email: { equals: normalizedIdentifier } },
        include: technicianInclude,
      });
    }
    case 'd7':
      return db.technician.findUnique({
        where: { d7Number: normalizedIdentifier },
        include: technicianInclude,
      });
    case 'username':
      return db.technician.findUnique({
        where: { apexUsername: normalizedIdentifier },
        include: technicianInclude,
      });
    default:
      return null;
  }
}

function toTechnicianForSession(
  tech: TechnicianWithDealership,
  dealershipOverride?: { id: string; name: string; dealerId: string | null }
): TechnicianForSession {
  const dealership = dealershipOverride ?? {
    id: tech.dealership.id,
    name: tech.dealership.name,
    dealerId: tech.dealership.dealerId,
  };

  return {
    id: tech.id,
    d7Number: tech.d7Number,
    name: tech.name,
    role: tech.role,
    isAdmin: tech.isAdmin,
    dealershipId: dealership.id,
    dealerId: tech.dealerId ?? dealership.dealerId,
    serviceAdvisorId: tech.serviceAdvisorId,
    sessionVersion: tech.sessionVersion,
    consentAt: tech.consentAt,
    consentVersion: tech.consentVersion,
    legalDisclaimerAt: tech.legalDisclaimerAt,
    legalDisclaimerVersion: tech.legalDisclaimerVersion,
    mustChangePassword: tech.mustChangePassword,
    preferredLanguage: tech.preferredLanguage,
    dealership: { name: dealership.name, dealerId: dealership.dealerId },
  };
}

export function mapMembershipsToLoginDealerships(
  memberships: Awaited<ReturnType<typeof listActiveDealershipMemberships>>
): LoginDealershipOption[] {
  return memberships.map((membership) => ({
    id: membership.dealership.id,
    name: membership.dealership.name,
    dealerCode: null,
    isPrimary: membership.isPrimary,
  }));
}

/** Load memberships with dealer codes for the dealership selector (apex login). */
async function listLoginDealershipOptions(technicianId: string): Promise<LoginDealershipOption[]> {
  const memberships = await getRlsDb().technicianDealership.findMany({
    where: { technicianId: technicianId.trim(), isActive: true },
    include: {
      dealership: {
        select: {
          id: true,
          name: true,
          dealerId: true,
          dealer: { select: { code: true } },
        },
      },
    },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  return memberships.map((membership) => ({
    id: membership.dealership.id,
    name: membership.dealership.name,
    dealerCode: membership.dealership.dealer?.code ?? null,
    isPrimary: membership.isPrimary,
  }));
}

export function validateTechnicianForLogin(
  tech: Technician | null,
  credentialType: Exclude<CredentialType, 'invalid'>
): tech is TechnicianWithDealership {
  if (!tech || !isTechnicianAccountActive(tech)) return false;
  if (!isCredentialRoleAllowed(credentialType, tech.role)) return false;
  if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) return false;
  return true;
}

/**
 * APEX unified login — email (owner), D7 (Mercedes), or apex username (multi-brand).
 * MERLINUS: use loginTechnician() in the route for backward-compatible D7-only login.
 */
export async function resolveUnifiedLogin(
  identifier: string,
  password: string
): Promise<UnifiedLoginResult> {
  // Phase 6.2 — credential lookup is control-plane (default-deny Technician RLS).
  return withRlsBypass(async () => {
  const credentialType = detectCredentialType(identifier);
  if (credentialType === 'invalid') return { status: 'invalid' };

  const normalizedIdentifier = normalizeCredentialIdentifier(credentialType, identifier);
  const tech = await findTechnicianByCredential(credentialType, normalizedIdentifier);
  if (!validateTechnicianForLogin(tech, credentialType)) return { status: 'invalid' };

  const passwordValid = await verifyPassword(password, tech.passwordHash);
  if (!passwordValid) return { status: 'invalid' };

  if (tech.role === 'owner') {
    // Owners: email (platform) or apex username (group). Home = group or platform national.
    if (credentialType !== 'email' && credentialType !== 'username') return { status: 'invalid' };
    const ownerSession = await buildOwnerHomeSession(tech.id);
    if (!ownerSession) return { status: 'invalid' };
    return {
      status: 'success',
      credentialType,
      session: {
        ...ownerSession,
        isOwner: true,
        activeDealershipId: undefined,
      },
    };
  }

  const memberships = await listActiveDealershipMemberships(tech.id);
  if (memberships.length === 0) return { status: 'invalid' };

  if (memberships.length === 1) {
    const membership = memberships[0];
    const base = buildSessionPayloadFromTechnician(
      toTechnicianForSession(tech, {
        id: membership.dealership.id,
        name: membership.dealership.name,
        dealerId: membership.dealership.dealerId,
      })
    );
    return {
      status: 'success',
      credentialType,
      session: {
        ...base,
        scopeMode: 'dealership',
        activeDealershipId: membership.dealership.id,
      },
    };
  }

  return {
    status: 'select_dealership',
    technicianId: tech.id,
    sessionVersion: tech.sessionVersion,
    credentialType,
    dealerships: await listLoginDealershipOptions(tech.id),
  };
  });
}