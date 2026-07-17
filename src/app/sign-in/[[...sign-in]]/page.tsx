import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { ClerkSignInView } from '@/components/ClerkSignInView';
import { LoadingScreen } from '@/components/LoadingScreen';
import { clerkEnvConfigured, getAuthMode } from '@/lib/authMode';

export default function SignInPage() {
  const mode = getAuthMode();

  if (mode === 'legacy' || !clerkEnvConfigured()) {
    redirect('/');
  }

  return (
    <Suspense
      fallback={
        <LoadingScreen label="Loading sign-in" sublabel="Preparing secure authentication…" />
      }
    >
      <ClerkSignInView showLegacyLink={mode === 'dual'} />
    </Suspense>
  );
}