'use client';

import type { ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/** Root-level React error boundary — catches render errors anywhere under the app shell. */
export function GlobalErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary scope="Merlinus">{children}</ErrorBoundary>;
}