'use client';

import { ClerkProvider, useClerk } from '@clerk/nextjs';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { clerkPublishableKeyConfigured } from '@/lib/authModeClient';
import { logoutSession } from '@/lib/loginSession';

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim();

type MerlinLogoutFn = () => Promise<void>;

const MerlinLogoutContext = createContext<MerlinLogoutFn | null>(null);

async function legacyLogoutOnly(): Promise<void> {
  await logoutSession();
}

function ClerkLogoutBridge({ children }: { children: ReactNode }) {
  const clerk = useClerk();

  const logout = useCallback(async () => {
    await logoutSession();
    try {
      await clerk.signOut();
    } catch {
      // Server route already attempted Clerk session revocation.
    }
  }, [clerk]);

  return <MerlinLogoutContext.Provider value={logout}>{children}</MerlinLogoutContext.Provider>;
}

/** Wraps the app with Clerk when a publishable key is configured. */
export function ClerkAppProvider({ children }: { children: ReactNode }) {
  if (!clerkPublishableKeyConfigured() || !publishableKey) {
    return (
      <MerlinLogoutContext.Provider value={legacyLogoutOnly}>{children}</MerlinLogoutContext.Provider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
    >
      <ClerkLogoutBridge>{children}</ClerkLogoutBridge>
    </ClerkProvider>
  );
}

export function useMerlinLogoutFromContext(): MerlinLogoutFn {
  const logout = useContext(MerlinLogoutContext);
  return logout ?? legacyLogoutOnly;
}