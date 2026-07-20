/** Shared public-route definitions for middleware and auth integration tests. */

export const MERLIN_PUBLIC_ROUTE_PATTERNS = [
  '/',
  '/sign-in(.*)',
  '/v(.*)',
  '/terms',
  '/privacy',
  '/portal(.*)',
  '/manifest.json',
  '/manifest.webmanifest',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/clerk/link',
  '/api/webhooks/clerk',
  '/api/public/video(.*)',
  '/api/public/hub(.*)',
  '/api/voice/inbound',
  '/api/voice/gather(.*)',
  '/api/voice/status',
  '/api/voice/recording',
] as const;

const PUBLIC_PATHS = new Set([
  '/',
  '/sign-in',
  '/terms',
  '/privacy',
  '/manifest.json',
  '/manifest.webmanifest',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/clerk/link',
  '/api/webhooks/clerk',
]);

export function isMerlinPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith('/sign-in/')) return true;
  if (pathname.startsWith('/v/') || pathname === '/v') return true;
  if (pathname.startsWith('/portal/') || pathname === '/portal') return true;
  if (pathname.startsWith('/api/public/video/')) return true;
  if (pathname.startsWith('/api/public/hub/')) return true;
  // PR-M5a — Twilio voice webhooks (signature-validated in handlers)
  if (
    pathname === '/api/voice/inbound' ||
    pathname === '/api/voice/status' ||
    pathname === '/api/voice/recording' ||
    pathname.startsWith('/api/voice/gather')
  ) {
    return true;
  }
  return false;
}