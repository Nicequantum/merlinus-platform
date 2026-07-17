import 'server-only';

import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { stripEnvQuotes } from '@/lib/apex/seedOwnerAccounts';

/**
 * Phase 6.1 — explicit platform operator allowlist.
 *
 * National (all-rooftop) access is NEVER implied by "no DealerGroup membership".
 * Operators must appear in env:
 *
 *   APEX_PLATFORM_OWNER_EMAILS=ops1@example.com,ops2@example.com
 *
 * Seed owner emails (OWNER_SEED_EMAIL / OWNER_SEED_EMAIL_2) are also treated as
 * platform operators when set — so one env pair both creates (create-only) and
 * authorizes national scope. Group owners use DealerGroupMembership only.
 */
export function parsePlatformOwnerEmailsFromEnv(): Set<string> {
  const emails = new Set<string>();

  const add = (raw: string | undefined) => {
    const email = stripEnvQuotes(raw).toLowerCase();
    if (email.includes('@')) emails.add(email);
  };

  const allowlist = process.env.APEX_PLATFORM_OWNER_EMAILS ?? '';
  for (const part of allowlist.split(/[,;\s]+/)) {
    if (part.trim()) add(part);
  }

  add(process.env.OWNER_SEED_EMAIL);
  add(process.env.OWNER_SEED_EMAIL_2);

  return emails;
}

export function isPlatformOperatorEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase() ?? '';
  if (!normalized.includes('@')) return false;
  return parsePlatformOwnerEmailsFromEnv().has(normalized);
}

/**
 * True when this technician is an explicit platform operator (all-rooftop capability).
 * Group-only owners return false even with zero memberships.
 */
export async function isPlatformOperator(technicianId: string): Promise<boolean> {
  const id = technicianId.trim();
  if (!id) return false;

  const allowlist = parsePlatformOwnerEmailsFromEnv();
  if (allowlist.size === 0) return false;

  return withRlsBypass(async () => {
    const tech = await getRlsDb().technician.findUnique({
      where: { id },
      select: { email: true, role: true, isActive: true, deletedAt: true },
    });

    if (!tech || tech.role !== 'owner' || !tech.isActive || tech.deletedAt) {
      return false;
    }

    return isPlatformOperatorEmail(tech.email);
  });
}
