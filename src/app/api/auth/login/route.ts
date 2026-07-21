import { NextResponse } from 'next/server';
import {
  detectCredentialType,
  INVALID_CREDENTIALS_MESSAGE,
} from '@/lib/apex/credentialType';
import {
  createPendingSelectionToken,
  issueApexSessionCookies,
} from '@/lib/apex/apexSession';
import {
  LEGACY_LOGIN_FAILURE_MESSAGE,
  resolveUnifiedLogin,
} from '@/lib/apex/loginResolver';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import { applySessionCookieToResponse, createSessionToken, loginTechnician } from '@/lib/auth';
import { applyCsrfCookieToResponse } from '@/lib/csrf';
import { isLegacyAuthPathEnabled } from '@/lib/authMode';
import { getDb } from '@/lib/db';
import { isApexPlatformMode } from '@/lib/platformMode';
import { apiError, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiWriteRequest } from '@/lib/requestLogging';
import { AUTH_JSON_BODY_LIMIT_BYTES, loginRequestSchema, parseRequestBody } from '@/lib/validation';

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(request, 'auth.login', RATE_LIMITS.auth);
  if (rateLimited) return rateLimited;

  try {
    if (!isLegacyAuthPathEnabled()) {
      return apiError('Legacy D7 login is disabled. Use Clerk sign-in.', 403);
    }

    // Bind D1 via getCloudflareContext before any Prisma/auth work (Workers: no fs).
    await getDb();

    const parsed = await parseRequestBody(request, loginRequestSchema, AUTH_JSON_BODY_LIMIT_BYTES);
    if ('error' in parsed) {
      return parsed.error;
    }

    const { identifier, password } = parsed.data;
    // Apex mode (PLATFORM_MODE / NEXT_PUBLIC / APEX_ENV) uses unified email/D7/username login.
    const apexMode = isApexPlatformMode();

    if (!apexMode) {
      // Merlinus: D7-only. Owner email logins require PLATFORM_MODE=apex (or APEX_ENV=1).
      const session = await loginTechnician(identifier, password);
      if (!session) {
        return apiError(LEGACY_LOGIN_FAILURE_MESSAGE, 401);
      }

      const token = await createSessionToken(session);

      await writeAuditedAccess({
        action: 'auth.login',
        dealershipId: session.dealershipId,
        dealerId: auditDealerIdFromSession(session),
        technicianId: session.technicianId,
        entityType: 'technician',
        entityId: session.technicianId,
        ipAddress: getRequestIp(request),
        authSource: 'legacy',
      });

      const response = NextResponse.json({ session, authSource: 'legacy' as const });
      applySessionCookieToResponse(response, token);
      applyCsrfCookieToResponse(response);
      logApiWriteRequest({
        routeKey: 'auth.login',
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
      });
      return response;
    }

    // Phase 6.1: never re-seed / re-hash owners on failed login (password overwrite vector).
    const loginResult = await resolveUnifiedLogin(identifier, password);

    if (loginResult.status === 'invalid') {
      logger.warn('auth.login_invalid', {
        apexMode: true,
        credentialType: detectCredentialType(identifier),
        identifierKind: detectCredentialType(identifier),
      });
      return apiError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    if (loginResult.status === 'select_dealership') {
      const pendingToken = await createPendingSelectionToken({
        technicianId: loginResult.technicianId,
        credentialType: loginResult.credentialType,
        sessionVersion: loginResult.sessionVersion,
      });

      const response = NextResponse.json({
        requiresDealershipSelection: true,
        pendingToken,
        technicianId: loginResult.technicianId,
        credentialType: loginResult.credentialType,
        dealerships: loginResult.dealerships,
      });
      logApiWriteRequest({
        routeKey: 'auth.login',
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        technicianId: loginResult.technicianId,
      });
      return response;
    }

    const { session } = loginResult;

    // Ensure owner national fields are always present for the client router.
    const clientSession =
      session.role === 'owner'
        ? {
            ...session,
            scopeMode: (session.scopeMode ?? 'national') as 'national' | 'dealership',
            isOwner: true as const,
            activeDealershipId:
              session.scopeMode === 'dealership' ? session.activeDealershipId : undefined,
          }
        : {
            ...session,
            scopeMode: (session.scopeMode ?? 'dealership') as 'national' | 'dealership',
            isOwner: false as const,
          };

    await writeAuditedAccess({
      action: 'auth.login',
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      entityType: 'technician',
      entityId: session.technicianId,
      ipAddress: getRequestIp(request),
      authSource: 'legacy',
      scopeMode: clientSession.scopeMode,
      metadata: { credentialType: loginResult.credentialType },
    });

    const response = NextResponse.json({
      session: clientSession,
      authSource: 'legacy' as const,
      credentialType: loginResult.credentialType,
    });
    await issueApexSessionCookies(response, clientSession, request, { authSource: 'legacy' });
    applyCsrfCookieToResponse(response);
    logApiWriteRequest({
      routeKey: 'auth.login',
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });
    return response;
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.login',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.login');
  }
}