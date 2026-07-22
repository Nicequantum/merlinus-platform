/**
 * Single entry for client-side auth helpers used by login shells.
 * Prefer this over importing @/lib/api for session/login (keeps login bundle small).
 *
 * Merlinus + Apex both use these helpers; Apex adds dealership selection in apexLoginSession.
 */

export {
  acceptConsentSession,
  acceptLegalDisclaimerSession,
  fetchClerkLinkStatus,
  fetchCurrentSession,
  linkClerkAccountSession,
  loginWithCredentials,
  logoutSession,
  probeCurrentSession,
  verifyMfaLogin,
  type ClerkLinkStatus,
  type MerlinLoginResult,
  type SessionProbeResult,
  type SessionProbeStatus,
} from '@/lib/loginSession';
