/**
 * Client-safe auth mode helpers (NEXT_PUBLIC_* only — no server secrets).
 */

import { parseAuthMode, type AuthMode } from '@/lib/authMode';

export function getClientAuthMode(): AuthMode {
  return parseAuthMode(process.env.NEXT_PUBLIC_AUTH_MODE);
}

export function clerkPublishableKeyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

/** True when the Clerk sign-in route should be reachable in the UI. */
export function isClerkSignInAvailable(): boolean {
  const mode = getClientAuthMode();
  if (mode === 'legacy') return false;
  return clerkPublishableKeyConfigured();
}

/** True when the home page should redirect anonymous users to Clerk sign-in. */
export function shouldUseClerkOnlyLogin(): boolean {
  return getClientAuthMode() === 'clerk' && clerkPublishableKeyConfigured();
}