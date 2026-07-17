'use client';

import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

interface ApexLoadingScreenProps {
  label?: string;
  sublabel?: string;
}

export function ApexLoadingScreen({
  label = 'Starting Apex',
  sublabel,
}: ApexLoadingScreenProps) {
  return (
    <div
      className="apex-app-root flex flex-col items-center justify-center min-h-dvh px-6 text-center"
      data-platform="apex"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="apex-brand-hero mb-6">
        <ApexLogoMark size="xl" title="Apex National Platform" animated />
        <p className="apex-wordmark">
          Apex
          <span className="apex-wordmark-accent">National Platform</span>
        </p>
      </div>
      <p className="text-sm font-semibold tracking-tight animate-pulse" style={{ color: 'var(--apex-silver)' }}>
        {label}
      </p>
      {sublabel ? (
        <p className="text-xs mt-2 max-w-xs leading-relaxed" style={{ color: 'var(--apex-text-secondary)' }}>
          {sublabel}
        </p>
      ) : null}
      <span className="sr-only">{sublabel ? `${label}. ${sublabel}` : label}</span>
    </div>
  );
}