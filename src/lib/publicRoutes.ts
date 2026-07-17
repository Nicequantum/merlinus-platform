/** Shared public-route definitions for middleware and auth integration tests. */

export const MERLIN_PUBLIC_ROUTE_PATTERNS = [
  '/',
  '/sign-in(.*)',
  '/v(.*)',
  '/manifest.json',
  '/manifest.webmanifest',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/clerk/link',
  '/api/webhooks/clerk',
  '/api/public/video(.*)',
] as const;

const PUBLIC_PATHS = new Set([
  '/',
  '/sign-in',
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
  if (pathname.startsWith('/api/public/video/')) return true;
  return false;
}