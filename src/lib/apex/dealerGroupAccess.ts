import 'server-only';

import { isPlatformOperator } from '@/lib/apex/platformOperator';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';

export interface OwnerDealerGroupMembership {
  dealerGroupId: string;
  dealerGroupCode: string;
  dealerGroupName: string;
  legalName: string | null;
  role: string;
  isPrimary: boolean;
}

/** Active DealerGroup memberships for an owner technician. */
export async function listOwnerDealerGroupMemberships(
  technicianId: string
): Promise<OwnerDealerGroupMembership[]> {
  return withRlsBypass(async () => {
    const rows = await getRlsDb().dealerGroupMembership.findMany({
      where: {
        technicianId: technicianId.trim(),
        isActive: true,
        dealerGroup: { status: 'active' },
      },
      select: {
        role: true,
        isPrimary: true,
        dealerGroup: {
          select: { id: true, code: true, name: true, legalName: true },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      dealerGroupId: row.dealerGroup.id,
      dealerGroupCode: row.dealerGroup.code,
      dealerGroupName: row.dealerGroup.name,
      legalName: row.dealerGroup.legalName,
      role: row.role,
      isPrimary: row.isPrimary,
    }));
  });
}

/** Primary membership, or first active group if none marked primary. */
export async function resolvePrimaryDealerGroupForOwner(
  technicianId: string
): Promise<OwnerDealerGroupMembership | null> {
  const memberships = await listOwnerDealerGroupMemberships(technicianId);
  if (memberships.length === 0) return null;
  return memberships.find((m) => m.isPrimary) ?? memberships[0] ?? null;
}

/**
 * Dealership ids an owner may enter.
 * - Explicit platform operator (env allowlist): all non-sentinel rooftops
 * - Group member: rooftops under dealers in their active group memberships
 * - Otherwise: none (no implicit "empty membership = superuser")
 */
export async function listEnterableDealershipsForOwner(technicianId: string): Promise<
  Array<{ id: string; name: string; dealerCode: string | null; dealerGroupId: string | null }>
> {
  return withRlsBypass(async () => {
    if (await isPlatformOperator(technicianId)) {
      const dealerships = await getRlsDb().dealership.findMany({
        where: { id: { not: APEX_NATIONAL_DEALERSHIP_ID } },
        select: {
          id: true,
          name: true,
          dealerId: true,
          dealer: { select: { code: true, dealerGroupId: true } },
        },
        orderBy: { name: 'asc' },
      });
      return dealerships.map((d) => ({
        id: d.id,
        name: d.name,
        dealerCode: d.dealer?.code ?? null,
        dealerGroupId: d.dealer?.dealerGroupId ?? null,
      }));
    }

    const memberships = await listOwnerDealerGroupMemberships(technicianId);
    const groupIds = memberships.map((m) => m.dealerGroupId);
    if (groupIds.length === 0) {
      return [];
    }

    const dealerships = await getRlsDb().dealership.findMany({
      where: {
        id: { not: APEX_NATIONAL_DEALERSHIP_ID },
        dealer: { dealerGroupId: { in: groupIds } },
      },
      select: {
        id: true,
        name: true,
        dealer: { select: { code: true, dealerGroupId: true } },
      },
      orderBy: { name: 'asc' },
    });

    return dealerships.map((d) => ({
      id: d.id,
      name: d.name,
      dealerCode: d.dealer?.code ?? null,
      dealerGroupId: d.dealer?.dealerGroupId ?? null,
    }));
  });
}

/**
 * True if owner may enter this rooftop.
 * Re-checked on enter AND on every owner dealership session rebuild (Phase 6.1).
 */
export async function ownerMayEnterDealership(
  technicianId: string,
  dealershipId: string
): Promise<boolean> {
  const id = dealershipId.trim();
  if (!id || id === APEX_NATIONAL_DEALERSHIP_ID) return false;

  return withRlsBypass(async () => {
    if (await isPlatformOperator(technicianId)) {
      const exists = await getRlsDb().dealership.findUnique({
        where: { id },
        select: { id: true },
      });
      return Boolean(exists);
    }

    const memberships = await listOwnerDealerGroupMemberships(technicianId);
    if (memberships.length === 0) return false;

    const groupIds = memberships.map((m) => m.dealerGroupId);
    const rooftop = await getRlsDb().dealership.findFirst({
      where: {
        id,
        dealer: { dealerGroupId: { in: groupIds } },
      },
      select: { id: true },
    });
    return Boolean(rooftop);
  });
}

/**
 * Dealer ids for owner national summary filters.
 * - Platform operator → null (unscoped / all active dealers)
 * - Group member → dealer ids in those groups
 * - Otherwise → empty array (no dealers)
 */
export async function listDealerIdsForOwnerGroups(technicianId: string): Promise<string[] | null> {
  return withRlsBypass(async () => {
    if (await isPlatformOperator(technicianId)) {
      return null;
    }

    const memberships = await listOwnerDealerGroupMemberships(technicianId);
    if (memberships.length === 0) return [];

    const dealers = await getRlsDb().dealer.findMany({
      where: {
        dealerGroupId: { in: memberships.map((m) => m.dealerGroupId) },
        status: 'active',
      },
      select: { id: true },
    });
    return dealers.map((d) => d.id);
  });
}
