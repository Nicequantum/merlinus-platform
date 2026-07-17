import 'server-only';

import {
  ownerMayEnterDealership,
  resolvePrimaryDealerGroupForOwner,
} from '@/lib/apex/dealerGroupAccess';
import {
  APEX_NATIONAL_DEALERSHIP_ID,
  APEX_NATIONAL_DEALERSHIP_NAME,
} from '@/lib/apex/platformConstants';
import type { AuditScopeMode } from '@/lib/apex/platformConstants';
import { isPlatformOperator } from '@/lib/apex/platformOperator';
import {
  buildSessionPayloadFromTechnician,
  type SessionPayload,
  type TechnicianForSession,
} from '@/lib/auth';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { isTechnicianAccountActive } from '@/lib/technicianAccounts';

function ownerTechnicianForSession(
  tech: TechnicianForSession,
  dealership: { id: string; name: string; dealerId: string | null; timezone?: string | null },
  scopeMode: AuditScopeMode,
  group?: { id: string; name: string } | null
): SessionPayload {
  const base = buildSessionPayloadFromTechnician({
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
    dealership: {
      name: dealership.name,
      dealerId: dealership.dealerId,
      timezone: dealership.timezone,
    },
  });

  return {
    ...base,
    scopeMode,
    isOwner: true,
    activeDealershipId: scopeMode === 'dealership' ? dealership.id : undefined,
    activeDealerGroupId: scopeMode === 'group' ? group?.id : undefined,
    dealerGroupName: scopeMode === 'group' ? group?.name : undefined,
    dealershipTimezone:
      scopeMode === 'dealership' ? dealership.timezone?.trim() || base.dealershipTimezone : undefined,
    // National/group home never carries a staff View As lens
    viewAsRole: undefined,
    viewAsAdmin: undefined,
    viewAsServiceAdvisorId: undefined,
  };
}

export type OwnerViewAsOptions = {
  viewAsRole?: 'technician' | 'manager' | 'service_advisor' | null;
  viewAsAdmin?: boolean;
  viewAsServiceAdvisorId?: string | null;
};

async function resolveViewAsForRooftop(
  dealershipId: string,
  options?: OwnerViewAsOptions
): Promise<{
  viewAsRole: 'technician' | 'manager' | 'service_advisor' | null;
  viewAsAdmin: boolean;
  viewAsServiceAdvisorId: string | null;
}> {
  const viewAsRole = options?.viewAsRole ?? null;
  const viewAsAdmin = Boolean(options?.viewAsAdmin) && viewAsRole === 'manager';
  let viewAsServiceAdvisorId: string | null = null;

  if (viewAsRole === 'service_advisor') {
    const requested = options?.viewAsServiceAdvisorId?.trim() || null;
    if (requested) {
      const advisor = await getRlsDb().serviceAdvisor.findFirst({
        where: {
          id: requested,
          dealershipId,
          deletedAt: null,
          status: 'active',
        },
        select: { id: true },
      });
      if (!advisor) {
        throw new Error('VIEW_AS_ADVISOR_NOT_FOUND');
      }
      viewAsServiceAdvisorId = advisor.id;
    } else {
      const first = await getRlsDb().serviceAdvisor.findFirst({
        where: { dealershipId, deletedAt: null, status: 'active' },
        orderBy: { displayNameEncrypted: 'asc' },
        select: { id: true },
      });
      if (!first) {
        throw new Error('VIEW_AS_NO_ADVISORS');
      }
      viewAsServiceAdvisorId = first.id;
    }
  }

  return { viewAsRole, viewAsAdmin, viewAsServiceAdvisorId };
}

type OwnerTechRow = {
  id: string;
  name: string;
  role: string;
  isAdmin: boolean;
  isActive: boolean;
  deletedAt: Date | null;
  serviceAdvisorId: string | null;
  sessionVersion: number;
  consentAt: Date | null;
  consentVersion: string | null;
  legalDisclaimerAt: Date | null;
  legalDisclaimerVersion: string | null;
  dealershipId: string;
  mustChangePassword: boolean;
  d7Number: string | null;
  apexUsername: string | null;
  preferredLanguage: string;
};

async function loadOwnerTech(technicianId: string): Promise<OwnerTechRow | null> {
  return withRlsBypass(async () => {
    const tech = await getRlsDb().technician.findUnique({
      where: { id: technicianId.trim() },
      select: {
        id: true,
        name: true,
        role: true,
        isAdmin: true,
        isActive: true,
        deletedAt: true,
        serviceAdvisorId: true,
        sessionVersion: true,
        consentAt: true,
        consentVersion: true,
        legalDisclaimerAt: true,
        legalDisclaimerVersion: true,
        dealershipId: true,
        mustChangePassword: true,
        d7Number: true,
        apexUsername: true,
        preferredLanguage: true,
      },
    });

    if (!tech || !isTechnicianAccountActive(tech) || tech.role !== 'owner') return null;
    return tech;
  });
}

/** Heal mis-stamped dealership FK without wiping owner login identifiers. */
async function healOwnerNationalFk(tech: OwnerTechRow): Promise<void> {
  if (tech.dealershipId === APEX_NATIONAL_DEALERSHIP_ID) return;
  void withRlsBypass(async () =>
    getRlsDb().technician.update({
      where: { id: tech.id },
      data: {
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        dealerId: null,
        // Never clear apexUsername / email — group owners login with username
      },
    })
  ).catch(() => undefined);
}

function nationalPayload(tech: OwnerTechRow, scopeMode: 'national' | 'group', group?: { id: string; name: string }) {
  return ownerTechnicianForSession(
    {
      id: tech.id,
      d7Number: tech.d7Number,
      name: tech.name,
      role: tech.role,
      isAdmin: tech.isAdmin,
      dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
      dealerId: null,
      serviceAdvisorId: tech.serviceAdvisorId,
      sessionVersion: tech.sessionVersion,
      consentAt: tech.consentAt,
      consentVersion: tech.consentVersion,
      legalDisclaimerAt: tech.legalDisclaimerAt,
      legalDisclaimerVersion: tech.legalDisclaimerVersion,
      mustChangePassword: tech.mustChangePassword,
      preferredLanguage: tech.preferredLanguage,
      dealership: {
        name: scopeMode === 'group' && group ? group.name : APEX_NATIONAL_DEALERSHIP_NAME,
        dealerId: null,
      },
    },
    {
      id: APEX_NATIONAL_DEALERSHIP_ID,
      name: scopeMode === 'group' && group ? group.name : APEX_NATIONAL_DEALERSHIP_NAME,
      dealerId: null,
    },
    scopeMode,
    group
  );
}

/**
 * Platform-wide national owner session.
 * Phase 7.1 H5 — only explicit platform operators (env allowlist), never "empty membership".
 * Prefer {@link buildOwnerHomeSession} for login / exit-dealership.
 */
export async function buildOwnerNationalSession(technicianId: string): Promise<SessionPayload | null> {
  const tech = await loadOwnerTech(technicianId);
  if (!tech) return null;
  if (!(await isPlatformOperator(tech.id))) return null;
  await healOwnerNationalFk(tech);
  return nationalPayload(tech, 'national');
}

/** Group-scoped owner home (DealerGroup portfolio). */
export async function buildOwnerGroupSession(
  technicianId: string,
  dealerGroupId: string
): Promise<SessionPayload | null> {
  const tech = await loadOwnerTech(technicianId);
  if (!tech) return null;

  const membership = await withRlsBypass(async () =>
    getRlsDb().dealerGroupMembership.findFirst({
      where: {
        technicianId: tech.id,
        dealerGroupId: dealerGroupId.trim(),
        isActive: true,
        dealerGroup: { status: 'active' },
      },
      select: {
        dealerGroup: { select: { id: true, name: true } },
      },
    })
  );
  if (!membership) return null;

  await healOwnerNationalFk(tech);
  return nationalPayload(tech, 'group', membership.dealerGroup);
}

/**
 * Login / exit home session (Phase 7.1 H5):
 * - Active DealerGroup membership → scopeMode group
 * - Explicit platform operator (no group) → scopeMode national
 * - Otherwise → null (no implicit national superuser)
 */
export async function buildOwnerHomeSession(technicianId: string): Promise<SessionPayload | null> {
  const tech = await loadOwnerTech(technicianId);
  if (!tech) return null;

  const primaryGroup = await resolvePrimaryDealerGroupForOwner(tech.id);
  if (primaryGroup) {
    return buildOwnerGroupSession(tech.id, primaryGroup.dealerGroupId);
  }
  if (await isPlatformOperator(tech.id)) {
    return buildOwnerNationalSession(tech.id);
  }
  return null;
}

export async function buildOwnerDealershipSession(
  technicianId: string,
  dealershipId: string,
  viewAs?: OwnerViewAsOptions
): Promise<SessionPayload | null> {
  return withRlsBypass(async () => {
    const tech = await getRlsDb().technician.findUnique({
      where: { id: technicianId.trim() },
      include: { dealership: true },
    });

    if (!tech || !isTechnicianAccountActive(tech) || tech.role !== 'owner') return null;

    const targetId = dealershipId.trim();
    if (!targetId || targetId === APEX_NATIONAL_DEALERSHIP_ID) return null;

    // Phase 6.1 — re-validate group/platform enter rights on every session rebuild/refresh.
    // Prevents stale rooftop access after membership revocation.
    const allowed = await ownerMayEnterDealership(tech.id, targetId);
    if (!allowed) return null;

    const dealership = await getRlsDb().dealership.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        dealerId: true,
        timezone: true,
        dealer: { select: { dealerGroupId: true, dealerGroup: { select: { id: true, name: true } } } },
      },
    });

    if (!dealership || dealership.id === APEX_NATIONAL_DEALERSHIP_ID) return null;

    let lens: Awaited<ReturnType<typeof resolveViewAsForRooftop>>;
    try {
      lens = await resolveViewAsForRooftop(dealership.id, viewAs);
    } catch {
      return null;
    }

    const payload = ownerTechnicianForSession(
      {
        id: tech.id,
        d7Number: tech.d7Number,
        name: tech.name,
        role: tech.role,
        isAdmin: tech.isAdmin,
        dealershipId: tech.dealershipId,
        dealerId: tech.dealerId,
        // For advisor lens, expose bound advisor as serviceAdvisorId so existing UI/APIs work
        serviceAdvisorId:
          lens.viewAsRole === 'service_advisor'
            ? lens.viewAsServiceAdvisorId
            : tech.serviceAdvisorId,
        sessionVersion: tech.sessionVersion,
        consentAt: tech.consentAt,
        consentVersion: tech.consentVersion,
        legalDisclaimerAt: tech.legalDisclaimerAt,
        legalDisclaimerVersion: tech.legalDisclaimerVersion,
        mustChangePassword: tech.mustChangePassword,
        preferredLanguage: tech.preferredLanguage,
        dealership: {
          name: dealership.name,
          dealerId: dealership.dealerId,
          timezone: dealership.timezone,
        },
      },
      {
        id: dealership.id,
        name: dealership.name,
        dealerId: dealership.dealerId,
        timezone: dealership.timezone,
      },
      'dealership'
    );

    const withLens: SessionPayload = {
      ...payload,
      dealershipTimezone: dealership.timezone || payload.dealershipTimezone,
      viewAsRole: lens.viewAsRole,
      viewAsAdmin: lens.viewAsAdmin,
      viewAsServiceAdvisorId: lens.viewAsServiceAdvisorId,
      serviceAdvisorId:
        lens.viewAsRole === 'service_advisor' ? lens.viewAsServiceAdvisorId : payload.serviceAdvisorId,
    };

    // Preserve group context while inside a rooftop for exit routing / UI
    const group = dealership.dealer?.dealerGroup;
    if (group) {
      return {
        ...withLens,
        activeDealerGroupId: group.id,
        dealerGroupName: group.name,
      };
    }

    return withLens;
  });
}
