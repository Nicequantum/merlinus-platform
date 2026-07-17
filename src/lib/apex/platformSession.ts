import 'server-only';

import { getSessionContext, type SessionPayload } from '@/lib/auth';
import {
  APEX_ACCESS_COOKIE,
  getApexSessionContext,
  type ApexAccessClaims,
} from '@/lib/apex/apexSession';
import { isApexPlatformMode } from '@/lib/platformMode';

function requestHasApexAccessCookie(request?: Request): boolean {
  if (!request) return false;
  const header = request.headers.get('cookie') || '';
  return header.includes(`${APEX_ACCESS_COOKIE}=`);
}

/**
 * Platform-aware JWT session resolution.
 * MERLINUS: benz_tech_session (8h legacy JWT).
 * APEX: apex_access short-lived JWT (+ apex_refresh for renewal).
 *
 * Prefer apex cookies when PLATFORM_MODE=apex OR when the request already carries
 * apex_access (survives brief PLATFORM_MODE misconfiguration after password login).
 */
export async function resolvePlatformSessionContext(request?: Request): Promise<{
  session: SessionPayload | null;
  jwtPayload: SessionPayload | ApexAccessClaims | null;
}> {
  if (isApexPlatformMode() || requestHasApexAccessCookie(request)) {
    const apex = await getApexSessionContext(request);
    if (apex.session || isApexPlatformMode()) {
      return apex;
    }
  }
  return getSessionContext(request);
}