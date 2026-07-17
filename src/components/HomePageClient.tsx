'use client';

import { Suspense } from 'react';
import { ApexPlatformApp } from '@/components/apex/ApexPlatformApp';
import { ApexLoadingScreen } from '@/components/apex/ApexLoadingScreen';
import { BenzTechApp } from '@/components/BenzTechApp';
import { LoadingScreen } from '@/components/LoadingScreen';
import type { PlatformMode } from '@/lib/platformMode';

interface HomePageClientProps {
  platformMode: PlatformMode;
}

/** Client entry for / — routes Merlinus vs Apex without changing Merlinus when mode is default. */
export default function HomePageClient({ platformMode }: HomePageClientProps) {
  if (platformMode === 'apex') {
    return (
      <Suspense
        fallback={
          <ApexLoadingScreen
            label="Starting Apex"
            sublabel="Loading national platform…"
          />
        }
      >
        <ApexPlatformApp />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <LoadingScreen label="Starting Merlinus" sublabel="Loading warranty documentation tools…" />
      }
    >
      <BenzTechApp />
    </Suspense>
  );
}