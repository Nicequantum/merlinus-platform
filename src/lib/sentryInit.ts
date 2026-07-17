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

export function initSentryServer(): void {
  const dsn = getSentryDsn();
  if (!dsn) return;

  // H-5: 0.2 in production — balances latency/error visibility with cost and noise at dealership scale
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  Sentry.init({
    dsn,
    tracesSampleRate: isProduction ? 0.2 : 1.0,
    debug: false,
    beforeSend(event) {
      scrubSentryEventWithRequestId(event as unknown as Record<string, unknown>);
      return event;
    },
  });
}

export function initSentryEdge(): void {
  const dsn = getSentryDsn();
  if (!dsn) return;

  Sentry.init({
    dsn,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    debug: false,
    beforeSend(event) {
      scrubSentryEventWithRequestId(event as unknown as Record<string, unknown>);
      return event;
    },
  });
}
