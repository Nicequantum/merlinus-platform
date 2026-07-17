import 'server-only';

import type { Prisma, TechnicianDealership, TechnicianRole } from '@prisma/client';
import { getRlsDb } from '@/lib/apex/rlsContext';

/** Thrown when a technician has no active membership for the requested dealership. */
export class DealershipMembershipError extends Error {
  readonly code = 'DEALERSHIP_MEMBERSHIP_REQUIRED';

  constructor(message = 'No active dealership membership for this account') {
    super(message);
    this.name = 'DealershipMembershipError';
  }
}

export type TechnicianDealershipWithDealership = Prisma.TechnicianDealershipGetPayload<{
  include: { dealership: { select: { id: true; name: true; dealerId: true } } };
}>;

export interface MembershipAssertOptions {
  /** Include rooftop name and dealerId on the returned row. */
  includeDealership?: boolean;
}

function membershipInclude(
  includeDealership: boolean
): Prisma.TechnicianDealershipInclude | undefined {
  if (!includeDealership) return undefined;
  return {
    dealership: { select: { id: true, name: true, dealerId: true } },
  };
}

async function loadActiveDealershipMembership(
  technicianId: string,
  dealershipId: string,
  options: MembershipAssertOptions = {}
): Promise<TechnicianDealership | TechnicianDealershipWithDealership | null> {
  const trimmedTechId = technicianId.trim();
  const trimmedDealershipId = dealershipId.trim();
  if (!trimmedTechId || !trimmedDealershipId) return null;

  return getRlsDb().technicianDealership.findFirst({
    where: {
      technicianId: trimmedTechId,
      dealershipId: trimmedDealershipId,
      isActive: true,
    },
    include: membershipInclude(options.includeDealership ?? false),
  });
}

/**
 * Verify an active TechnicianDealership row exists for the technician + rooftop.
 * APEX NATIONAL PLATFORM — membership is the source of truth for dealership scoping.
 * MERLINUS SINGLE-DEALER: backfill ensures every legacy technician has exactly one row.
 */
export async function assertDealershipMembership(
  technicianId: string,
  dealershipId: string,
  options: MembershipAssertOptions = {}
): Promise<TechnicianDealership | TechnicianDealershipWithDealership> {
  const membership = await loadActiveDealershipMembership(technicianId, dealershipId, options);
  if (!membership) {
    throw new DealershipMembershipError();
  }
  return membership;
}

/** Non-throwing lookup — returns null when no active membership exists. */
export async function findActiveDealershipMembership(
  technicianId: string,
  dealershipId: string,
  options: MembershipAssertOptions = {}
): Promise<TechnicianDealership | TechnicianDealershipWithDealership | null> {
  return loadActiveDealershipMembership(technicianId, dealershipId, options);
}

/** List active rooftops for a technician (multi-dealership selector / switcher). */
export async function listActiveDealershipMemberships(
  technicianId: string
): Promise<TechnicianDealershipWithDealership[]> {
  return getRlsDb().technicianDealership.findMany({
    where: { technicianId: technicianId.trim(), isActive: true },
    include: { dealership: { select: { id: true, name: true, dealerId: true } } },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });
}

/** Count active memberships — login routing uses 0 / 1 / many. */
export async function countActiveDealershipMemberships(technicianId: string): Promise<number> {
  return getRlsDb().technicianDealership.count({
    where: { technicianId: technicianId.trim(), isActive: true },
  });
}

/** Upsert membership when technician roster or primary rooftop changes (seed / admin). */
export async function upsertTechnicianDealershipMembership(input: {
  technicianId: string;
  dealershipId: string;
  role: TechnicianRole;
  isPrimary?: boolean;
  isActive?: boolean;
}): Promise<TechnicianDealership> {
  const technicianId = input.technicianId.trim();
  const dealershipId = input.dealershipId.trim();

  return getRlsDb().technicianDealership.upsert({
    where: {
      technicianId_dealershipId: { technicianId, dealershipId },
    },
    create: {
      technicianId,
      dealershipId,
      role: input.role,
      isPrimary: input.isPrimary ?? true,
      isActive: input.isActive ?? true,
    },
    update: {
      role: input.role,
      isPrimary: input.isPrimary ?? undefined,
      isActive: input.isActive ?? undefined,
    },
  });
}