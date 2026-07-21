/**
 * P0-4 — API default-deny policy.
 *
 * Every src/app/api route.ts must use an approved wrapper OR appear on the
 * intentional bare allowlist (with a documented control: rate limit, signature,
 * SETUP_SECRET, etc.).
 *
 * Approved wrappers (source must call one of these):
 *   - withAuth
 *   - withPublicRoute
 *   - withStoryAiRoute  (composes withAuth)
 *
 * CI: npm run check:api-routes
 */

/** Patterns that count as an approved gateway (substring match on route source). */
export const APPROVED_API_ROUTE_WRAPPERS = [
  'withAuth(',
  'withPublicRoute(',
  'withStoryAiRoute(',
] as const;

/**
 * Routes allowed without the wrappers above.
 * Keys are POSIX paths relative to repo root (forward slashes).
 * Values document the compensating control — do not add casually.
 */
export const INTENTIONAL_BARE_API_ROUTES: Readonly<Record<string, string>> = {
  'src/app/api/auth/login/route.ts':
    'Public login — RATE_LIMITS.auth + credential verification',
  'src/app/api/auth/logout/route.ts':
    'Session clear — rate limited; safe when unauthenticated',
  'src/app/api/auth/me/route.ts':
    'Session probe — rate limited; returns null session when unauthenticated',
  'src/app/api/auth/refresh/route.ts':
    'Refresh cookie rotation — RATE_LIMITS.auth + refresh token validation',
  'src/app/api/auth/select-dealership/route.ts':
    'Multi-rooftop selection token — RATE_LIMITS.auth + pending selection JWT',
  'src/app/api/setup/seed/route.ts':
    'Bootstrap only — blocked in production middleware + SETUP_SECRET bearer',
  'src/app/api/voice/inbound/route.ts':
    'Twilio webhook — validateTwilioSignature + voice_agent module gate',
  'src/app/api/voice/gather/route.ts':
    'Twilio webhook — validateTwilioSignature',
  'src/app/api/voice/status/route.ts':
    'Twilio status callback — validateTwilioSignature',
  'src/app/api/voice/recording/route.ts':
    'Twilio recording callback — validateTwilioSignature',
  'src/app/api/webhooks/clerk/route.ts':
    'Clerk Svix webhook — verifyWebhook()',
  // P3-4 recovery uses withPublicRoute (approved wrapper) — not bare.
};

export function isIntentionalBareApiRoute(posixPath: string): boolean {
  const normalized = posixPath.replace(/\\/g, '/');
  return Object.prototype.hasOwnProperty.call(INTENTIONAL_BARE_API_ROUTES, normalized);
}

export function routeHasApprovedWrapper(source: string): boolean {
  return APPROVED_API_ROUTE_WRAPPERS.some((w) => source.includes(w));
}
