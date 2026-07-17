import * as Sentry from '@sentry/nextjs';
import { clientLog } from '@/lib/clientLog';
// Client-safe scrub module only (server init uses Node ALS request ids separately).
import { getSentryDsn, scrubSentryEventForClient } from '@/lib/sentryScrub';

const dsn = getSentryDsn();

if (dsn) {
  try {
    const environment =
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() ||
      process.env.NEXT_PUBLIC_VERCEL_ENV?.trim() ||
      process.env.NODE_ENV ||
      'development';
    const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT?.trim();
    Sentry.init({
      dsn,
      environment,
      release: commit && commit !== 'dev' && commit !== 'unknown' ? `merlinus@${commit}` : undefined,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      debug: false,
      initialScope: {
        tags: {
          productSurface: 'dealership-os',
        },
      },
      // Phase 7.2 H8 — client scrubber parity with server
      beforeSend(event) {
        scrubSentryEventForClient(event);
        return event;
      },
    });
  } catch (error) {
    clientLog.error('telemetry.sentry_init_failed', error);
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
