'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, type ReactNode } from 'react';
import { ClerkAppProvider } from '@/components/ClerkAppProvider';
import { GlobalErrorBoundary } from '@/components/GlobalErrorBoundary';
import { OfflineBanner } from '@/components/OfflineBanner';
import { I18nProvider } from '@/i18n/I18nProvider';
import { clientLog } from '@/lib/clientLog';

function useUnhandledRejectionLogging(): void {
  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      clientLog.error('client.unhandled_rejection', {
        reason: reason instanceof Error ? reason.message : reason,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      try {
        Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
      } catch {
        // Telemetry must never interfere with login or repair-order workflows.
      }
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', onUnhandledRejection);
  }, []);
}

/** Client-side app shell: global error boundary, offline banner, and rejection logging. */
export function AppProviders({ children }: { children: ReactNode }) {
  useUnhandledRejectionLogging();

  return (
    <ClerkAppProvider>
      <I18nProvider>
        <GlobalErrorBoundary>
          <OfflineBanner />
          {children}
        </GlobalErrorBoundary>
      </I18nProvider>
    </ClerkAppProvider>
  );
}