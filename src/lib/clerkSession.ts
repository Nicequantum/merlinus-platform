import 'server-only';

import { auth, clerkClient } from '@clerk/nextjs/server';
import { isClerkAuthPathEnabled } from '@/lib/authMode';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { logger } from '@/lib/logger';

/** Revoke the active Clerk browser session when present. */
export async function revokeActiveClerkSession(): Promise<boolean> {
  if (!isClerkAuthPathEnabled()) return false;

  try {
    const { sessionId } = await auth();
    if (!sessionId) return false;

    const client = await clerkClient();
    await client.sessions.revokeSession(sessionId);
    logger.info('auth.clerk_session_revoked', { sessionId });
    return true;
  } catch (error) {
    logger.warn('auth.clerk_session_revoke_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Revoke all active Clerk sessions for a linked Clerk user. */
export async function revokeAllClerkSessionsForUser(clerkUserId: string): Promise<void> {
  if (!isClerkAuthPathEnabled()) return;

  try {
    const client = await clerkClient();
    const sessions = await client.sessions.getSessionList({
      userId: clerkUserId,
      status: 'active',
      limit: 100,
    });

    await Promise.all(
      sessions.data.map((session) => client.sessions.revokeSession(session.id))
    );

    if (sessions.data.length > 0) {
      logger.info('auth.clerk_sessions_revoked', {
        clerkUserId,
        count: sessions.data.length,
      });
    }
  } catch (error) {
    logger.warn('auth.clerk_sessions_revoke_failed', {
      clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Revoke legacy JWT sessions and any linked Clerk sessions for a technician. */
export async function revokeTechnicianAuthSessions(
  technicianId: string,
  revokeLegacy: () => Promise<void>
): Promise<void> {
  await revokeLegacy();

  const technician = await withRlsBypass(async () =>
    getRlsDb().technician.findUnique({
      where: { id: technicianId },
      select: { clerkUserId: true },
    })
  );

  if (technician?.clerkUserId) {
    await revokeAllClerkSessionsForUser(technician.clerkUserId);
  }
}