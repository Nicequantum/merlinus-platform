/**
 * POST /api/auth/mfa/login-verify — complete login after password stage (TOTP or backup code).
 */
import { NextResponse } from 'next/server';
import {
  createPendingSelectionToken,
  issueApexSessionCookies,
} from '@/lib/apex/apexSession';
import {
  resolveLoginAfterMfa,
  type UnifiedLoginResult,
} from '@/lib/apex/loginResolver';
import { isApexPlatformMode } from '@/lib/platformMode';
import { auditDealerIdFromSession } from '@/lib/audit';
import { writeAuditedAccess } from '@/lib/auditedAccess';
import {
  applySessionCookieToResponse,
  createSessionToken,
  buildSessionPayloadFromTechnician,
  type TechnicianForSession,
} from '@/lib/auth';
import { applyCsrfCookieFromRequest, validateCsrfRequest } from '@/lib/csrf';
import { getDb } from '@/lib/db';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import { apiError, handleRouteError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { consumePendingMfaToken, verifyPendingMfaToken } from '@/lib/mfa/challenge';
import { verifyMfaFactor } from '@/lib/mfa/service';
import { checkRateLimit, getRequestIp, RATE_LIMITS } from '@/lib/rate-limit';
import { logApiWriteRequest } from '@/lib/requestLogging';
import { AUTH_JSON_BODY_LIMIT_BYTES, parseRequestBody } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  mfaToken: z.string().trim().min(20).max(4096),
  code: z.string().trim().min(6).max(20),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  const rateLimited = await checkRateLimit(
    request,
    'auth.mfa.login-verify',
    RATE_LIMITS.authMfaLogin
  );
  if (rateLimited) return rateLimited;

  const csrfError = validateCsrfRequest(request);
  if (csrfError) return apiError(csrfError, 403);

  try {
    await getDb();
    const parsed = await parseRequestBody(request, bodySchema, AUTH_JSON_BODY_LIMIT_BYTES);
    if ('error' in parsed) return parsed.error;

    const claims = await verifyPendingMfaToken(parsed.data.mfaToken);
    if (!claims) {
      return apiError('MFA challenge expired or invalid. Sign in again.', 401);
    }

    const factor = await verifyMfaFactor({
      technicianId: claims.technicianId,
      code: parsed.data.code,
    });

    if (!factor.ok) {
      try {
        await writeAuditedAccess({
          action: 'auth.mfa_failure',
          dealershipId: '',
          technicianId: claims.technicianId,
          entityType: 'technician',
          entityId: claims.technicianId,
          ipAddress: getRequestIp(request),
          metadata: { stage: 'login_verify', error: factor.error.slice(0, 120) },
        });
      } catch {
        // best-effort
      }
      return apiError(factor.error, 401);
    }

    const consumed = await consumePendingMfaToken(parsed.data.mfaToken);
    if (!consumed) {
      return apiError('MFA challenge already used. Sign in again.', 401);
    }

    const credentialType = (claims.credentialType || 'd7') as
      | 'email'
      | 'd7'
      | 'username';

    const apexMode = isApexPlatformMode();
    let loginResult: UnifiedLoginResult;

    if (apexMode) {
      loginResult = await resolveLoginAfterMfa(claims.technicianId, credentialType);
    } else {
      // Merlinus legacy: single rooftop session from technician row
      const session = await withRlsBypass(async () => {
        const tech = await getRlsDb().technician.findUnique({
          where: { id: claims.technicianId },
          include: { dealership: true },
        });
        if (!tech) return null;
        const forSession: TechnicianForSession = {
          id: tech.id,
          d7Number: tech.d7Number,
          name: tech.name,
          role: tech.role,
          isAdmin: tech.isAdmin,
          dealershipId: tech.dealershipId,
          dealerId: tech.dealerId,
          serviceAdvisorId: tech.serviceAdvisorId,
          sessionVersion: tech.sessionVersion,
          consentAt: tech.consentAt,
          consentVersion: tech.consentVersion,
          legalDisclaimerAt: tech.legalDisclaimerAt,
          legalDisclaimerVersion: tech.legalDisclaimerVersion,
          mustChangePassword: tech.mustChangePassword,
          preferredLanguage: tech.preferredLanguage,
          mfaEnabled: tech.mfaEnabled,
          mfaEnrolledAt: tech.mfaEnrolledAt,
          dealership: {
            name: tech.dealership.name,
            dealerId: tech.dealership.dealerId,
            timezone: tech.dealership.timezone,
          },
        };
        return buildSessionPayloadFromTechnician(forSession);
      });
      if (!session) {
        return apiError('Account not found.', 401);
      }
      loginResult = {
        status: 'success',
        session,
        credentialType: 'd7',
      };
    }

    if (loginResult.status === 'invalid') {
      return apiError('Could not complete sign-in after MFA.', 401);
    }

    if (loginResult.status === 'select_dealership') {
      const pendingToken = await createPendingSelectionToken({
        technicianId: loginResult.technicianId,
        credentialType: loginResult.credentialType,
        sessionVersion: loginResult.sessionVersion,
      });
      try {
        await writeAuditedAccess({
          action: 'auth.mfa_success',
          dealershipId: '',
          technicianId: claims.technicianId,
          entityType: 'technician',
          entityId: claims.technicianId,
          ipAddress: getRequestIp(request),
          metadata: {
            method: factor.method,
            next: 'select_dealership',
          },
        });
      } catch {
        // best-effort
      }
      const response = NextResponse.json({
        requiresDealershipSelection: true,
        pendingToken,
        technicianId: loginResult.technicianId,
        credentialType: loginResult.credentialType,
        dealerships: loginResult.dealerships,
        mfaVerified: true,
      });
      logApiWriteRequest({
        routeKey: 'auth.mfa.login-verify',
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        technicianId: claims.technicianId,
      });
      return response;
    }

    if (loginResult.status === 'mfa_required') {
      // Should not re-challenge after successful factor
      logger.warn('auth.mfa_login_verify_loop', { technicianId: claims.technicianId });
      return apiError('MFA already verified but session could not be issued.', 500);
    }

    const { session } = loginResult;
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
      action: 'auth.mfa_success',
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      entityType: 'technician',
      entityId: session.technicianId,
      ipAddress: getRequestIp(request),
      authSource: 'legacy',
      metadata: { method: factor.method, stage: 'login' },
    });

    await writeAuditedAccess({
      action: 'auth.login',
      dealershipId: session.dealershipId,
      dealerId: auditDealerIdFromSession(session),
      technicianId: session.technicianId,
      entityType: 'technician',
      entityId: session.technicianId,
      ipAddress: getRequestIp(request),
      authSource: 'legacy',
      metadata: { mfa: true, method: factor.method },
    });

    if (factor.method === 'backup') {
      try {
        await writeAuditedAccess({
          action: 'auth.mfa_backup_used',
          dealershipId: session.dealershipId,
          dealerId: auditDealerIdFromSession(session),
          technicianId: session.technicianId,
          entityType: 'technician',
          entityId: session.technicianId,
          ipAddress: getRequestIp(request),
        });
      } catch {
        // best-effort
      }
    }

    if (apexMode) {
      const response = NextResponse.json({
        session: clientSession,
        authSource: 'legacy' as const,
        mfaVerified: true,
      });
      await issueApexSessionCookies(response, clientSession, request, { authSource: 'legacy' });
      applyCsrfCookieFromRequest(request, response);
      logApiWriteRequest({
        routeKey: 'auth.mfa.login-verify',
        method: request.method,
        status: response.status,
        durationMs: Date.now() - startedAt,
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
      });
      return response;
    }

    const token = await createSessionToken(clientSession);
    const response = NextResponse.json({
      session: clientSession,
      authSource: 'legacy' as const,
      mfaVerified: true,
    });
    applySessionCookieToResponse(response, token);
    applyCsrfCookieFromRequest(request, response);
    logApiWriteRequest({
      routeKey: 'auth.mfa.login-verify',
      method: request.method,
      status: response.status,
      durationMs: Date.now() - startedAt,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });
    return response;
  } catch (error) {
    logApiWriteRequest({
      routeKey: 'auth.mfa.login-verify',
      method: request.method,
      status: 500,
      durationMs: Date.now() - startedAt,
      failed: true,
    });
    return handleRouteError(error, 'auth.mfa.login-verify');
  }
}
