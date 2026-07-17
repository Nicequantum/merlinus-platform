'use client';

import { useMerlinLogoutFromContext } from '@/components/ClerkAppProvider';

/** Signs out legacy JWT (API) and Clerk browser session when configured. */
export function useMerlinLogout() {
  return useMerlinLogoutFromContext();
}