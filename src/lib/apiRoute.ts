import { NextResponse } from 'next/server';
import { withSessionRls } from '@/lib/apex/rlsContext';
import {
  DealershipScopeRequiredError,
  enrichSessionWithTenantScope,
  ownerMayExerciseDealershipPrivilege,
  requireDealershipScope,
  requireOwnerNationalScope,
} from '@/lib/apex/tenantScope';
import { isApexPlatformMode } from '@/lib/platformMode';
import { resolveAppSession, type AuthSource } from './authBridge';
import { isMaintenanceModeEnabled } from './env';
import {
  apiError,
  CONSENT_REQUIRED_ERROR,
  DAILY_USAGE_LIMIT_ERROR,
  FORBIDDEN_ERROR,
  GENERIC_ERROR,
  handleRouteError,
  LEGAL_DISCLAIMER_REQUIRED_ERROR,
  MAINTENANCE_MODE_ERROR,
  PASSWORD_CHANGE_REQUIRED_ERROR,
  UNAUTHORIZED_ERROR,
} from './errors';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '@/types';
import { logPerformance } from './perf';
import {
  applyRequestIdHeader,
  resolveRequestIdFromRequest,
  runWithRequestContext,
} from './requestContext';
import { logApiWriteRequest } from './requestLogging';
import { checkRateLimit, RATE_LIMITS, type RateLimitConfig } from './rate-limit';
import { blockServiceAdvisorAi as blockServiceAdvisorAiGuard } from './roleGuards';
import { isDailyUsageLimitReached, logApiUsage } from './usageMonitoring';

type Session = NonNullable<Awaited<ReturnType<typeof resolveAppSession>>>;

export type { AuthSource };

interface RouteOptions {
  rateLimitKey?: string;
  rateLimit?: RateLimitConfig;
  requireManager?: boolean;
  requireAdmin?: boolean;
  /** Count toward per-technician daily AI usage (50/day) and persist to UsageLog. */
  trackUsage?: boolean;
  /** When true, allow the route before privacy consent is recorded (e.g. POST /api/consent). */
  skipConsent?: boolean;
  /** When true, allow the route before legal disclaimer is recorded (e.g. POST /api/legal-disclaimer). */
  skipLegalDisclaimer?: boolean;
  /**
   * Allow while Technician.mustChangePassword is true (change-password, logout, me).
   * Default false — PII routes blocked until password rotated after provision.
   */
  skipPasswordChange?: boolean;
  /**
   * P1-3 — allow while MFA enrollment is still required (mfa routes, logout, me).
   * Default false when MERLIN_MFA_ENFORCE blocks PII until enrolled.
   */
  skipMfa?: boolean;
  /**
   * P1-6 — skip CSRF double-submit check (rare; prefer not to use on browser session routes).
   */
  skipCsrf?: boolean;
  /** Block when MERLIN_MAINTENANCE_MODE is enabled (AI and heavy write paths). */
  blockInMaintenance?: boolean;
  /** APEX Phase 5.5 — owner-only routes (enter/exit dealership, national console). */
  requireOwner?: boolean;
  /**
   * Phase 6.3 — owner routes that require national scope (summary, dealership list).
   * Implies requireOwner. Exit dealership before calling these.
   */
  requireOwnerNational?: boolean;
  /** APEX Phase 5.5 — PII routes; blocks owners in national scope until enter-dealership. */
  requireDealershipContext?: boolean;
  /**
   * Phase 6.1+ — sensitive PII path. Enforces dealership context; handlers must use
   * writeAuditedAccess() (fail-closed) for durable compliance on writes/sensitive reads.
   */
  requireAuditedAccess?: boolean;
  /**
   * Phase 6.2 — wrap handler in withSessionRls (enforced tenant RLS + getRlsDb()).
   * Defaults to true when requireDealershipContext or requireAuditedAccess is set.
   */
  useRls?: boolean;
  /** Emit structured perf log for the route handler duration. */
  perfEvent?: string;
  /** Manager health and similar probes — skip rate limiting so monitoring is not blocked by KV. */
  skipRateLimit?: boolean;
  /**
   * Phase 7.3 (H14) — block service_advisor role from Grok/story mutation routes.
   */
  blockServiceAdvisorAi?: boolean;
  /**
   * PR-M0 — require product module entitlement(s) for this rooftop.
   * Implies dealership context. core_story is never a ModuleId (always on).
   * Disabled module → 403 MODULE_DISABLED.
   */
  requireModule?: import('@/lib/modules/catalog').ProductModuleId | import('@/lib/modules/catalog').ProductModuleId[];
}

export async function withAuth<T>(
  request: Request,
  handler: (session: Session) => Promise<T>,
  options: RouteOptions = {}
): Promise<NextResponse | Response> {
  const routeKey = options.rateLimitKey || 'api';
  const requestId = resolveRequestIdFromRequest(request);

  return runWithRequestContext({ requestId, routeKey }, () =>
    withAuthInner(request, handler, options, routeKey, requestId)
  );
}

async function withAuthInner<T>(
  request: Request,
  handler: (session: Session) => Promise<T>,
  options: RouteOptions,
  routeKey: string,
  requestId: string
): Promise<NextResponse | Response> {
  if (options.blockInMaintenance && isMaintenanceModeEnabled()) {
    return apiError(MAINTENANCE_MODE_ERROR, 503);
  }

  if (!options.skipRateLimit) {
    const rateLimited = await checkRateLimit(
      request,
      routeKey,
      options.rateLimit || (options.trackUsage ? RATE_LIMITS.generate : RATE_LIMITS.default)
    );
    if (rateLimited) {
      applyRequestIdHeader(rateLimited, requestId);
      return rateLimited;
    }
  }

  // P1-6 CSRF double-submit (mutating methods only; skipped in test/CI)
  if (!options.skipCsrf) {
    const { validateCsrfRequest } = await import('@/lib/csrf');
    const csrfError = validateCsrfRequest(request, { skipCsrf: options.skipCsrf });
    if (csrfError) {
      return apiError(csrfError, 403);
    }
  }

  const rawSession = await resolveAppSession(request);
  if (!rawSession) {
    return apiError(UNAUTHORIZED_ERROR, 401);
  }

  const session = enrichSessionWithTenantScope(rawSession);

  if (options.requireOwner || options.requireOwnerNational) {
    if (!isApexPlatformMode() || !session.isOwner) {
      return apiError(FORBIDDEN_ERROR, 403);
    }
  }

  if (options.requireOwnerNational) {
    try {
      requireOwnerNationalScope(session);
    } catch (error) {
      if (error instanceof DealershipScopeRequiredError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 403 }
        );
      }
      throw error;
    }
  }

  // Phase 6.3: manager/admin rooftop routes always need dealership context + RLS.
  // requireOwner national routes must set requireDealershipContext: false explicitly if needed.
  const needsDealershipContext =
    options.requireDealershipContext === true ||
    options.requireAuditedAccess === true ||
    options.requireModule != null ||
    (options.requireManager === true && options.requireDealershipContext !== false) ||
    (options.requireAdmin === true &&
      options.requireDealershipContext !== false &&
      !options.requireOwner);

  if (needsDealershipContext) {
    try {
      requireDealershipScope(session);
    } catch (error) {
      if (error instanceof DealershipScopeRequiredError) {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 403 }
        );
      }
      throw error;
    }
  }

  // Phase 6.2/6.3: PII-heavy and manager routes default to withSessionRls so getRlsDb() is bound.
  // Skip auto-wrap for long AI/maintenance paths (trackUsage / blockInMaintenance) —
  // those routes call rlsTransaction() only around DB work (Grok must not sit in a tx).
  const useRls =
    options.useRls === true ||
    (options.useRls !== false &&
      needsDealershipContext &&
      !options.trackUsage &&
      !options.blockInMaintenance);
  if (options.requireManager) {
    // National Owner View As: owner + viewAsRole manager is allowed in dealership only.
    const { effectiveRole } = await import('@/lib/apex/viewAs');
    if (effectiveRole(session) !== 'manager') {
      return apiError(FORBIDDEN_ERROR, 403);
    }
    // Owners are never managers; belt-and-suspenders for mis-issued sessions.
    if (!ownerMayExerciseDealershipPrivilege(session)) {
      return NextResponse.json(
        {
          error: 'Dealership context required',
          code: 'DEALERSHIP_CONTEXT_REQUIRED',
        },
        { status: 403 }
      );
    }
  }

  if (options.requireAdmin) {
    const { effectiveIsAdmin } = await import('@/lib/apex/viewAs');
    if (!effectiveIsAdmin(session)) {
      return apiError(FORBIDDEN_ERROR, 403);
    }
    // Phase 6.1: national-scope owners cannot use dealership admin APIs via isAdmin seed flag.
    if (!options.requireOwner && !ownerMayExerciseDealershipPrivilege(session)) {
      return NextResponse.json(
        {
          error: 'Dealership context required for admin operations',
          code: 'DEALERSHIP_CONTEXT_REQUIRED',
        },
        { status: 403 }
      );
    }
  }

  if (!options.skipPasswordChange && session.mustChangePassword) {
    return NextResponse.json(
      { error: PASSWORD_CHANGE_REQUIRED_ERROR, code: 'PASSWORD_CHANGE_REQUIRED' },
      { status: 403 }
    );
  }

  if (!options.skipMfa && session.mfaRequired) {
    const { MFA_REQUIRED_ERROR } = await import('@/lib/mfa/policy');
    return NextResponse.json(
      { error: MFA_REQUIRED_ERROR, code: 'MFA_REQUIRED' },
      { status: 403 }
    );
  }

  if (!options.skipConsent) {
    if (!session.consentAt) {
      return apiError(CONSENT_REQUIRED_ERROR, 403);
    }
    // M5: getSession already resolved consentVersion from DB — avoid a second lookup.
    if (session.consentVersion !== CONSENT_VERSION) {
      return apiError(CONSENT_REQUIRED_ERROR, 403);
    }
  }

  if (!options.skipLegalDisclaimer) {
    if (!session.legalDisclaimerAt) {
      return apiError(LEGAL_DISCLAIMER_REQUIRED_ERROR, 403);
    }
    if (session.legalDisclaimerVersion !== LEGAL_DISCLAIMER_VERSION) {
      return apiError(LEGAL_DISCLAIMER_REQUIRED_ERROR, 403);
    }
  }

  // Phase 7.3 H14 — consistent service_advisor AI block
  if (options.blockServiceAdvisorAi) {
    const blocked = blockServiceAdvisorAiGuard(session);
    if (blocked) return blocked;
  }

  if (options.trackUsage) {
    // Phase 7.3 H7 — daily cap uses rooftop timezone when present on session
    const limitReached = await isDailyUsageLimitReached(
      session.technicianId,
      session.dealershipTimezone
    );
    if (limitReached) {
      return apiError(DAILY_USAGE_LIMIT_ERROR, 429);
    }
  }

  const startedAt = Date.now();
  const method = request.method;
  try {
    const runHandler = async () => {
      if (options.requireModule != null) {
        const { assertModuleEnabled, ModuleDisabledError } = await import('@/lib/modules/entitlements');
        const { dealershipId } = requireDealershipScope(session);
        const required = Array.isArray(options.requireModule)
          ? options.requireModule
          : [options.requireModule];
        try {
          for (const moduleId of required) {
            await assertModuleEnabled(dealershipId, moduleId);
          }
        } catch (error) {
          if (error instanceof ModuleDisabledError) {
            const { logger } = await import('@/lib/logger');
            logger.info('module.disabled_blocked', {
              moduleId: error.moduleId,
              dealershipId,
              routeKey,
              technicianId: session.technicianId,
            });
            try {
              const Sentry = await import('@sentry/nextjs');
              Sentry.setTag('moduleId', error.moduleId);
              Sentry.setTag('moduleGate', 'disabled');
            } catch {
              // Sentry optional
            }
            return NextResponse.json(
              { error: error.message, code: error.code, moduleId: error.moduleId },
              { status: 403 }
            );
          }
          throw error;
        }
      }
      return handler(session);
    };

    const result = useRls
      ? await withSessionRls(session, runHandler)
      : await runHandler();
    const status = result instanceof NextResponse || result instanceof Response ? result.status : 200;
    const isSuccessResponse = status >= 200 && status < 300;
    if (options.trackUsage && isSuccessResponse) {
      await logApiUsage({
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
        dealerId: session.dealerId,
        routeKey: routeKey,
      });
    }
    logApiWriteRequest({
      routeKey,
      method,
      status,
      durationMs: Date.now() - startedAt,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
    });
    if (options.perfEvent) {
      logPerformance(options.perfEvent, Date.now() - startedAt, {
        routeKey,
        technicianId: session.technicianId,
        dealershipId: session.dealershipId,
        status,
      });
    }
    if (result instanceof NextResponse || result instanceof Response) {
      applyRequestIdHeader(result, requestId);
      return result;
    }
    const json = NextResponse.json(result);
    applyRequestIdHeader(json, requestId);
    return json;
  } catch (error) {
    logApiWriteRequest({
      routeKey,
      method,
      status: 500,
      durationMs: Date.now() - startedAt,
      technicianId: session.technicianId,
      dealershipId: session.dealershipId,
      failed: true,
    });
    if (options.perfEvent) {
      logPerformance(options.perfEvent, Date.now() - startedAt, {
        routeKey,
        technicianId: session.technicianId,
        failed: true,
      });
    }
    return handleRouteError(error, routeKey);
  }
}

/**
 * Public / unauthenticated API gateway (P0-4).
 * Applies request id, optional rate limit, maintenance block, JSON error mapping.
 * Use for token-gated public routes and lightweight status — never for rooftop PII without a share token.
 */
export async function withPublicRoute<T>(
  request: Request,
  handler: () => Promise<T>,
  options: RouteOptions = {}
): Promise<NextResponse | Response> {
  const routeKey = options.rateLimitKey || 'public';
  const requestId = resolveRequestIdFromRequest(request);

  return runWithRequestContext({ requestId, routeKey }, async () => {
    if (options.blockInMaintenance && isMaintenanceModeEnabled()) {
      return apiError(MAINTENANCE_MODE_ERROR, 503);
    }

    if (!options.skipRateLimit) {
      const rateLimited = await checkRateLimit(
        request,
        routeKey,
        options.rateLimit || RATE_LIMITS.default
      );
      if (rateLimited) {
        applyRequestIdHeader(rateLimited, requestId);
        return rateLimited;
      }
    }

    // Public token routes may still mutate (rare); allow skipCsrf for media/passcode paths
    if (!options.skipCsrf) {
      const { validateCsrfRequest } = await import('@/lib/csrf');
      const csrfError = validateCsrfRequest(request, { skipCsrf: options.skipCsrf });
      if (csrfError) {
        return apiError(csrfError, 403);
      }
    }

    const startedAt = Date.now();
    const method = request.method;
    try {
      const result = await handler();
      const status = result instanceof NextResponse || result instanceof Response ? result.status : 200;
      logApiWriteRequest({
        routeKey,
        method,
        status,
        durationMs: Date.now() - startedAt,
      });
      if (options.perfEvent) {
        logPerformance(options.perfEvent, Date.now() - startedAt, { routeKey, status });
      }
      if (result instanceof NextResponse || result instanceof Response) {
        applyRequestIdHeader(result, requestId);
        return result;
      }
      const json = NextResponse.json(result);
      applyRequestIdHeader(json, requestId);
      return json;
    } catch (error) {
      logApiWriteRequest({
        routeKey,
        method,
        status: 500,
        durationMs: Date.now() - startedAt,
        failed: true,
      });
      if (options.perfEvent) {
        logPerformance(options.perfEvent, Date.now() - startedAt, { routeKey, failed: true });
      }
      // Always JSON — never leak HTML stack pages to API clients
      return handleRouteError(error, routeKey);
    }
  });
}

export function jsonError(message: string, status: number): NextResponse {
  return apiError(message, status);
}

export { GENERIC_ERROR };