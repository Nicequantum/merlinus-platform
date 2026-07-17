/**
 * Server/edge Sentry init.
 * Client instrumentation must import from `@/lib/sentryScrub` only.
 */
import * as Sentry from '@sentry/nextjs';
import { getRequestId } from '@/lib/requestContext';
import {
  getSentryDsn,
  scrubSentryEventForClient,
  scrubSentryEventInPlace,
} from '@/lib/sentryScrub';

export { getSentryDsn, scrubSentryEventForClient };

function scrubSentryEventWithRequestId(event: Record<string, unknown>): void {
  scrubSentryEventInPlace(event);
  // requestContext is Edge-safe (no node: imports); attach when ALS/stack has a store.
  const requestId = getRequestId();
  if (requestId) {
    const tags =
      event.tags && typeof event.tags === 'object'
        ? (event.tags as Record<string, unknown>)
        : {};
    event.tags = { ...tags, requestId };
  }
}

function sentryEnvironment(): string {
  return (
    process.env.SENTRY_ENVIRONMENT?.trim() ||
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    'development'
  );
}

function sentryRelease(): string | undefined {
  const commit =
    process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GIT_COMMIT?.trim();
  if (!commit || commit === 'dev' || commit === 'unknown') return undefined;
  return `merlinus@${commit}`;
}

function baseSentryOptions(isProduction: boolean): Parameters<typeof Sentry.init>[0] {
  return {
    dsn: getSentryDsn()!,
    environment: sentryEnvironment(),
    release: sentryRelease(),
    tracesSampleRate: isProduction ? 0.2 : 1.0,
    debug: false,
    initialScope: {
      tags: {
        platform: process.env.PLATFORM_MODE?.trim() || process.env.NEXT_PUBLIC_PLATFORM_MODE?.trim() || 'merlinus',
        productSurface: 'dealership-os',
      },
    },
    beforeSend(event) {
      scrubSentryEventWithRequestId(event as unknown as Record<string, unknown>);
      return event;
    },
  };
}

export function initSentryServer(): void {
  const dsn = getSentryDsn();
  if (!dsn) return;

  // H-5: 0.2 in production — balances latency/error visibility with cost and noise at dealership scale
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  Sentry.init(baseSentryOptions(isProduction));
}

export function initSentryEdge(): void {
  const dsn = getSentryDsn();
  if (!dsn) return;

  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const opts = baseSentryOptions(isProduction);
  Sentry.init({
    ...opts,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
  });
}
