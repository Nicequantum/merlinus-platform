/**
 * Client-safe Sentry event scrubbing (no Node builtins).
 * Used by instrumentation-client and by server/edge init via sentryInit.
 */
import { redactForLog, redactString } from '@/lib/logRedact';

/** Mutate Sentry event in place for secret scrubbing (Phase 7.2). */
export function scrubSentryEventInPlace(event: Record<string, unknown>): void {
  if (event.extra && typeof event.extra === 'object') {
    event.extra = redactForLog(event.extra as Record<string, unknown>);
  }

  if (event.tags && typeof event.tags === 'object') {
    event.tags = redactForLog(event.tags as Record<string, unknown>);
  }

  const request = event.request as
    | {
        data?: unknown;
        headers?: Record<string, string>;
        query_string?: unknown;
      }
    | undefined;

  if (request) {
    if (request.headers && typeof request.headers === 'object') {
      const headers = { ...request.headers };
      for (const key of Object.keys(headers)) {
        if (/authorization|cookie|set-cookie|x-api-key/i.test(key)) {
          headers[key] = '[Redacted]';
        }
      }
      request.headers = headers;
    }
    if (typeof request.data === 'string') {
      request.data =
        request.data.length > 200
          ? `[Redacted body ${request.data.length} chars]`
          : redactString(request.data);
    } else if (request.data && typeof request.data === 'object') {
      request.data = redactForLog(request.data as Record<string, unknown>);
    }
    if (request.query_string && typeof request.query_string === 'string') {
      request.query_string = redactString(request.query_string, 200);
    }
  }

  const exception = event.exception as { values?: Array<{ value?: string }> } | undefined;
  if (exception?.values) {
    for (const value of exception.values) {
      if (value.value) value.value = redactString(value.value, 1000);
    }
  }
}

export function getSentryDsn(): string | undefined {
  return process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
}

/** Client Sentry scrubber (shared with instrumentation-client). */
export function scrubSentryEventForClient(event: unknown) {
  if (event && typeof event === 'object') {
    scrubSentryEventInPlace(event as Record<string, unknown>);
  }
  return event;
}
