import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { withAuth } from '@/lib/apiRoute';
import { resolveLegacySessionContext } from '@/lib/authBridge';
import { clerkEnvConfigured, isClerkAuthPathEnabled } from '@/lib/authMode';
import {
  emailsMatchForClerkLink,
  getTechnicianClerkLinkState,
  manualLinkLegacySessionToClerk,
  resolveClerkUserEmail,
} from '@/lib/clerkIdentity';
import { apiError, handleRouteError } from '@/lib/errors';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { jsonWithSessionCookie, toTechnicianSession } from '@/lib/sessionRefresh';

export async function GET(request: Request) {
  const rateLimited = await checkRateLimit(request, 'auth.clerk.link.status', RATE_LIMITS.default);
  if (rateLimited) return rateLimited;

  try {
    const clerkEnabled = isClerkAuthPathEnabled();
    const legacy = await resolveLegacySessionContext(request);
    const legacySession = legacy.session;

    let clerkSignedIn = false;
    let clerkEmail: string | null = null;

    if (clerkEnabled && clerkEnvConfigured()) {
      try {
        const { userId } = await auth();
        if (userId) {
          clerkSignedIn = true;
          clerkEmail = await resolveClerkUserEmail(userId);
        }
      } catch {
        clerkSignedIn = false;
      }
    }

    const linkState = legacySession
      ? await getTechnicianClerkLinkState(legacySession.technicianId)
      : { linked: false, clerkUserId: null, email: '' };

    const canLink = Boolean(
      clerkEnabled &&
        legacySession &&
        clerkSignedIn &&
        !linkState.linked &&
        clerkEmail &&
        emailsMatchForClerkLink(linkState.email, clerkEmail)
    );

    return NextResponse.json({
      clerkEnabled,
      legacySignedIn: Boolean(legacySession),
      clerkSignedIn,
      linked: linkState.linked,
      canLink,
    });
  } catch (error) {
    return handleRouteError(error, 'auth.clerk.link.status');
  }
}

export async function POST(request: Request) {
  return withAuth(
    request,
    async (session) => {
      if (!isClerkAuthPathEnabled() || !clerkEnvConfigured()) {
        return apiError('Clerk linking is not enabled', 403);
      }

      const linkState = await getTechnicianClerkLinkState(session.technicianId);
      if (linkState.linked) {
        return NextResponse.json({
          linked: true,
          session: toTechnicianSession(session),
        });
      }

      const { userId } = await auth();
      if (!userId) {
        return apiError('Sign in with Clerk in this browser, then try linking again', 401);
      }

      const result = await manualLinkLegacySessionToClerk({
        technicianId: session.technicianId,
        clerkUserId: userId,
      });

      if (!result.linked) {
        return apiError(result.reason, 409);
      }

      await writeAuditedAccess({
        action: 'auth.clerk_link',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: session.technicianId,
        ipAddress: getRequestIp(request),
        metadata: { clerkUserId: userId },
      });

      const refreshed = await resolveLegacySessionContext(request);
      const payload = refreshed.session ?? session;

      return jsonWithSessionCookie(
        {
          linked: true,
          session: toTechnicianSession(payload),
        },
        payload,
        refreshed.jwtPayload
      );
    },
    {
      rateLimitKey: 'auth.clerk.link',
      skipConsent: true,
      skipLegalDisclaimer: true,
    }
  );
}