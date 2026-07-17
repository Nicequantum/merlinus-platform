import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';
import {
  buildSessionPayloadFromTechnician,
  type SessionPayload,
  type TechnicianForSession,
} from '@/lib/auth';
import { isClerkAuthPathEnabled } from '@/lib/authMode';
import {
  emailsMatchForClerkLink,
  extractClerkPrimaryEmail,
  normalizeAuthEmail,
} from '@/lib/clerkEmail';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';
import { isTechnicianAccountActive } from '@/lib/technicianAccounts';

export type ClerkLinkSource = 'webhook' | 'first_sign_in' | 'manual';

export type ClerkLinkResult =
  | { linked: true; technician: TechnicianForSession }
  | { linked: false; reason: string };

export { emailsMatchForClerkLink, extractClerkPrimaryEmail, normalizeAuthEmail } from '@/lib/clerkEmail';

/** Phase 7.1 H1 — Clerk identity is control-plane (RLS bypass). */
export async function linkTechnicianToClerkUser(params: {
  technicianId: string;
  clerkUserId: string;
  source: ClerkLinkSource;
}): Promise<ClerkLinkResult> {
  const { technicianId, clerkUserId, source } = params;

  return withRlsBypass(async () => {
    const existingByClerk = await getRlsDb().technician.findUnique({
      where: { clerkUserId },
      select: { id: true, email: true },
    });
    if (existingByClerk && existingByClerk.id !== technicianId) {
      return { linked: false, reason: 'Clerk account is already linked to another technician' };
    }

    const technician = await getRlsDb().technician.findUnique({
      where: { id: technicianId },
      include: { dealership: true },
    });

    if (!technician || !isTechnicianAccountActive(technician)) {
      return { linked: false, reason: 'Technician account is not active' };
    }

    if (technician.clerkUserId && technician.clerkUserId !== clerkUserId) {
      return { linked: false, reason: 'Technician is already linked to a different Clerk account' };
    }

    if (technician.clerkUserId === clerkUserId) {
      return { linked: true, technician };
    }

    const updated = await getRlsDb().technician.update({
      where: { id: technicianId },
      data: {
        clerkUserId,
        authProvider: 'clerk',
      },
      include: { dealership: true },
    });

    logger.info('auth.clerk_linked', {
      technicianId,
      clerkUserId,
      source,
      email: updated.email,
    });

    return { linked: true, technician: updated };
  });
}

export async function tryLinkClerkUserByEmail(params: {
  clerkUserId: string;
  email: string;
  source: ClerkLinkSource;
}): Promise<TechnicianForSession | null> {
  const normalizedEmail = normalizeAuthEmail(params.email);
  if (!normalizedEmail) return null;

  const technician = await withRlsBypass(async () =>
    getRlsDb().technician.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        clerkUserId: null,
        deletedAt: null,
        isActive: true,
      },
      include: { dealership: true },
    })
  );

  if (!technician || !isTechnicianAccountActive(technician)) return null;
  if (technician.role === 'service_advisor' && !technician.serviceAdvisorId) return null;

  const result = await linkTechnicianToClerkUser({
    technicianId: technician.id,
    clerkUserId: params.clerkUserId,
    source: params.source,
  });

  return result.linked ? result.technician : null;
}

export async function unlinkClerkUser(clerkUserId: string): Promise<void> {
  await withRlsBypass(async () => {
    const technician = await getRlsDb().technician.findUnique({
      where: { clerkUserId },
      select: { id: true },
    });
    if (!technician) return;

    await getRlsDb().technician.update({
      where: { id: technician.id },
      data: {
        clerkUserId: null,
        authProvider: 'legacy',
      },
    });

    logger.info('auth.clerk_unlinked', { technicianId: technician.id, clerkUserId });
  });
}

export async function resolveClerkUserEmail(clerkUserId: string): Promise<string | null> {
  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  return extractClerkPrimaryEmail({
    email_addresses: user.emailAddresses.map((entry) => ({
      id: entry.id,
      email_address: entry.emailAddress,
    })),
    primary_email_address_id: user.primaryEmailAddressId,
  });
}

export async function attemptClerkEmailLinkOnSignIn(
  clerkUserId: string
): Promise<SessionPayload | null> {
  if (!isClerkAuthPathEnabled()) return null;

  try {
    const email = await resolveClerkUserEmail(clerkUserId);
    if (!email) return null;

    const technician = await tryLinkClerkUserByEmail({
      clerkUserId,
      email,
      source: 'first_sign_in',
    });
    if (!technician) return null;

    return buildSessionPayloadFromTechnician(technician);
  } catch (error) {
    logger.warn('auth.clerk_auto_link_failed', {
      clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

type ClerkWebhookUser = {
  id: string;
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
};

export async function handleClerkWebhookUserEvent(
  eventType: string,
  user: ClerkWebhookUser
): Promise<void> {
  const clerkUserId = user.id;
  if (!clerkUserId) return;

  if (eventType === 'user.deleted') {
    await unlinkClerkUser(clerkUserId);
    return;
  }

  if (eventType !== 'user.created' && eventType !== 'user.updated') return;

  const email = extractClerkPrimaryEmail(user);
  if (!email) return;

  await tryLinkClerkUserByEmail({
    clerkUserId,
    email,
    source: 'webhook',
  });
}

export async function getTechnicianClerkLinkState(technicianId: string): Promise<{
  linked: boolean;
  clerkUserId: string | null;
  email: string;
}> {
  const technician = await withRlsBypass(async () =>
    getRlsDb().technician.findUnique({
      where: { id: technicianId },
      select: { clerkUserId: true, email: true },
    })
  );

  if (!technician) {
    return { linked: false, clerkUserId: null, email: '' };
  }

  return {
    linked: Boolean(technician.clerkUserId),
    clerkUserId: technician.clerkUserId,
    email: technician.email,
  };
}

export async function manualLinkLegacySessionToClerk(params: {
  technicianId: string;
  clerkUserId: string;
}): Promise<ClerkLinkResult> {
  const clerkEmail = await resolveClerkUserEmail(params.clerkUserId);
  if (!clerkEmail) {
    return { linked: false, reason: 'Clerk account has no verified email' };
  }

  const technician = await withRlsBypass(async () =>
    getRlsDb().technician.findUnique({
      where: { id: params.technicianId },
      select: { email: true },
    })
  );

  if (!technician) {
    return { linked: false, reason: 'Technician not found' };
  }

  if (!emailsMatchForClerkLink(technician.email, clerkEmail)) {
    return {
      linked: false,
      reason: 'Clerk email does not match your dealership account email',
    };
  }

  return linkTechnicianToClerkUser({
    technicianId: params.technicianId,
    clerkUserId: params.clerkUserId,
    source: 'manual',
  });
}

export async function loadLinkedTechnicianSession(
  clerkUserId: string
): Promise<SessionPayload | null> {
  const tech = await withRlsBypass(async () =>
    getRlsDb().technician.findUnique({
      where: { clerkUserId },
      include: { dealership: true },
    })
  );

  if (!tech || !isTechnicianAccountActive(tech)) return null;
  if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) return null;

  return buildSessionPayloadFromTechnician(tech);
}
