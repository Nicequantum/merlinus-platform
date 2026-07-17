import 'server-only';

import { revokeAllRefreshTokensForTechnician } from '@/lib/apex/apexSession';
import { incrementSessionVersion } from '@/lib/auth';
import { revokeTechnicianAuthSessions } from '@/lib/clerkSession';
import { logger } from '@/lib/logger';

/**
 * Phase 6.2 — full fortress revocation for a technician:
 * 1) bump sessionVersion (invalidates legacy + apex access JWTs)
 * 2) revoke all apex refresh token families
 * 3) revoke linked Clerk sessions when present
 */
export async function revokeAllSessionsForTechnician(technicianId: string): Promise<void> {
  const id = technicianId.trim();
  if (!id) return;

  await revokeTechnicianAuthSessions(id, async () => {
    await incrementSessionVersion(id);
    await revokeAllRefreshTokensForTechnician(id);
  });

  logger.info('auth.sessions_revoked_full', { technicianId: id });
}

/**
 * Scope-switch revocation: drop refresh families so prior national/dealership
 * cookies cannot be rotated after enter/exit dealership or multi-rooftop select.
 * Access JWTs expire short-lived; new cookies are re-issued by the route.
 */
export async function revokeApexRefreshForScopeSwitch(technicianId: string): Promise<void> {
  const id = technicianId.trim();
  if (!id) return;
  await revokeAllRefreshTokensForTechnician(id);
  logger.info('auth.apex_refresh_revoked_scope_switch', { technicianId: id });
}

/**
 * Phase 6.3 — password reset / admin kill-switch: full revoke without requiring
 * the target to hold an active browser session (no Clerk session-id needed beyond linked user).
 */
export async function revokeSessionsAfterCredentialChange(technicianId: string): Promise<void> {
  await revokeAllSessionsForTechnician(technicianId);
  logger.info('auth.sessions_revoked_credential_change', { technicianId: technicianId.trim() });
}
