/** Clerk email helpers — pure functions safe for unit tests and server linking. */

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function extractClerkPrimaryEmail(user: {
  email_addresses?: Array<{ id: string; email_address: string }>;
  primary_email_address_id?: string | null;
}): string | null {
  const addresses = user.email_addresses ?? [];
  if (addresses.length === 0) return null;

  const primaryId = user.primary_email_address_id;
  const primary = primaryId
    ? addresses.find((entry) => entry.id === primaryId)
    : addresses[0];

  const email = primary?.email_address?.trim();
  return email ? normalizeAuthEmail(email) : null;
}

export function emailsMatchForClerkLink(technicianEmail: string, clerkEmail: string): boolean {
  return normalizeAuthEmail(technicianEmail) === normalizeAuthEmail(clerkEmail);
}