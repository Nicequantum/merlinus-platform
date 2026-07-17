'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#08080a', color: '#f2f3f6' }}>
        <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, textAlign: 'center', background: '#14141a', border: '1px solid #2a2a34', borderRadius: 16, padding: 28 }}>
            <h1 style={{ fontSize: 18, margin: '0 0 8px' }}>Merlinus is unavailable</h1>
            <p style={{ fontSize: 14, color: '#9aa0ad', lineHeight: 1.5, margin: '0 0 20px' }}>
              A critical error stopped the app from loading. Reload the page or contact dealership IT.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{
                background: '#00adef',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '12px 24px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload Merlinus
            </button>
            {error.digest && (
              <p style={{ fontSize: 11, color: '#6b7280', marginTop: 16 }}>Reference: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}