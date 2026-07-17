import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { publicSafeMessage, redactString } from '@/lib/logRedact';
import { getRequestId } from '@/lib/requestContext';
import { logger } from './logger';
import type { RouteErrorMapping } from './scanRouteErrors';
import { mapRouteError } from './routeErrorMapper';

export const GENERIC_ERROR = 'Something went wrong. Please try again or contact your administrator.';
export const UNAUTHORIZED_ERROR = 'You must be signed in to perform this action.';
export const FORBIDDEN_ERROR = 'You do not have permission to perform this action.';
export const NOT_FOUND_ERROR = 'The requested resource was not found.';
export const VALIDATION_ERROR = 'Invalid request. Please check your input and try again.';
export const RATE_LIMIT_ERROR = 'Too many requests. Please wait a moment and try again.';
export const DAILY_USAGE_LIMIT_ERROR =
  'Daily AI usage limit reached (50 requests per technician). Try again tomorrow.';
export const SESSION_EXPIRED_ERROR = 'Your session has expired. Please sign in again.';
export const CONSENT_REQUIRED_ERROR =
  'Data and privacy consent is required before using Merlinus. Please accept the consent terms to continue.';
export const LEGAL_DISCLAIMER_REQUIRED_ERROR =
  'Legal disclaimer acknowledgment is required before using Merlinus. Please accept the disclaimer to continue.';
export const PASSWORD_CHANGE_REQUIRED_ERROR =
  'You must set a new password before continuing. Temporary provision passwords cannot access dealership data.';
export const MAINTENANCE_MODE_ERROR =
  'Merlinus is in maintenance mode. Story generation and uploads are paused — try again shortly.';
export const GROK_UNAVAILABLE_ERROR =
  'AI story generation is temporarily unavailable. Check bay Wi‑Fi or type your notes manually.';
export const IMAGE_ACCESS_ERROR =
  'This photo is not available for processing. Please re-upload and try again.';
export const IMAGE_STORAGE_ERROR =
  'Could not load uploaded photos from storage. Please re-upload and try again.';
export const PAYLOAD_TOO_LARGE_ERROR = 'Request is too large. Reduce attachments or split your input.';
export const OFFLINE_ERROR = 'No network connection. Your typed notes are safe — reconnect and try again.';
export const CONFLICT_ERROR =
  'This repair order was updated elsewhere. Reload the repair order to get the latest version.';

export function apiError(message: string, status: number): NextResponse {
  const body: Record<string, unknown> = {
    error: publicSafeMessage(message),
  };
  const requestId = getRequestId();
  if (requestId) body.requestId = requestId;
  const response = NextResponse.json(body, { status });
  if (requestId) {
    response.headers.set('x-request-id', requestId);
  }
  return response;
}

/** Phase 7.2 H9 — only report server errors to Sentry (skip expected 4xx). */
export function shouldCaptureRouteError(status: number): boolean {
  return status >= 500;
}

/**
 * Phase 7.2 H11 — report mapped early-return failures (Grok/Blob) with logging + Sentry for 5xx.
 */
export function reportMappedRouteError(
  mapped: RouteErrorMapping,
  error: unknown,
  context: string
): NextResponse {
  const err = error instanceof Error ? error : new Error(mapped.logDetail || 'mapped route error');
  const logLevel = mapped.status >= 500 ? 'error' : 'warn';
  logger[logLevel](mapped.status >= 500 ? 'route.error' : 'route.client_error', {
    context,
    error: redactString(err.message),
    logDetail: mapped.logDetail,
    status: mapped.status,
  });

  if (shouldCaptureRouteError(mapped.status)) {
    Sentry.captureException(err, {
      tags: {
        routeContext: context,
        requestId: getRequestId() ?? 'none',
        httpStatus: String(mapped.status),
      },
      extra: {
        routeContext: context,
        logDetail: mapped.logDetail,
        status: mapped.status,
        requestId: getRequestId(),
      },
    });
  }

  return apiError(mapped.message, mapped.status);
}

export function handleRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof Error && error.message === 'Unauthorized') {
    logger.warn('route.unauthorized', { context });
    return apiError(SESSION_EXPIRED_ERROR, 401);
  }

  const err = error instanceof Error ? error : new Error('unknown route error');
  const mapped = mapRouteError(error, context);

  logger.error(mapped.status >= 500 ? 'route.error' : 'route.client_error', {
    context,
    error: redactString(err.message),
    logDetail: mapped.logDetail,
    status: mapped.status,
  });

  // Phase 7.2 H9 — do not flood Sentry with expected 4xx domain errors
  if (shouldCaptureRouteError(mapped.status)) {
    Sentry.captureException(err, {
      tags: {
        routeContext: context,
        requestId: getRequestId() ?? 'none',
        httpStatus: String(mapped.status),
      },
      extra: {
        routeContext: context,
        logDetail: mapped.logDetail,
        status: mapped.status,
        requestId: getRequestId(),
      },
    });
  }

  return apiError(mapped.message, mapped.status);
}
