'use client';

import { type ReactNode } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

interface ViewErrorBoundaryProps {
  /** Human-readable screen name shown in the recovery UI. */
  viewName: string;
  children: ReactNode;
}

/** Isolates view-level render failures so the rest of Merlin stays usable. */
export function ViewErrorBoundary({ viewName, children }: ViewErrorBoundaryProps) {
  return <ErrorBoundary scope={viewName}>{children}</ErrorBoundary>;
}