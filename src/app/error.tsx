'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { clientLog } from '@/lib/clientLog';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    clientLog.error('route.error', { error: error.message, digest: error.digest, stack: error.stack });
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="app-container benz-page py-10 text-center min-h-dvh flex items-center justify-center px-6" role="alert">
      <div className="benz-card-elevated p-7 max-w-md w-full">
        <div className="text-lg font-semibold mb-2 tracking-tight">Merlinus hit a snag</div>
        <p className="text-sm text-benz-secondary mb-2 leading-relaxed">
          Something unexpected happened. Your repair order data on this page was not lost — try again or return to the
          home screen.
        </p>
        <p className="text-xs text-benz-muted mb-5">If this keeps happening, notify your service manager.</p>
        {error.digest && (
          <p className="text-xs text-benz-muted mb-4">Reference: {error.digest}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button type="button" onClick={reset} className="primary-btn px-6 h-11 text-sm touch-target">
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            className="secondary-btn px-6 h-11 text-sm touch-target"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}