'use client';

import { ApexLogoMark } from '@/components/apex/ApexLogoMark';

interface LoadingScreenProps {
  label?: string;
  sublabel?: string;
}

export function LoadingScreen({ label = 'Loading Apex', sublabel }: LoadingScreenProps) {
  return (
    <div
      className="app-container flex flex-col items-center justify-center min-h-dvh px-6 text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="merlin-brand-hero mb-6">
        <ApexLogoMark size="xl" title="Apex" animated />
      </div>
      <p className="text-sm text-benz-silver font-semibold tracking-tight animate-pulse">{label}</p>
      {sublabel && <p className="text-xs text-benz-secondary mt-2 max-w-xs leading-relaxed">{sublabel}</p>}
      <span className="sr-only">{sublabel ? `${label}. ${sublabel}` : label}</span>
    </div>
  );
}