import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { BASE_SECURITY_HEADERS, CONTENT_SECURITY_POLICY } from '../security-policy.mjs';
import {
  BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE,
  BOOTSTRAP_SEED_PATH,
  logBootstrapSeedBlockedAttempt,
} from './lib/bootstrapGuard';
import { isClerkAuthPathEnabled } from './lib/authMode';
import { CSRF_COOKIE } from './lib/csrfClient';
import { isProductionRuntime } from './lib/productionRuntime';
import { isMerlinPublicPath, MERLIN_PUBLIC_ROUTE_PATTERNS } from './lib/publicRoutes';
import { applySecurityHeaders, isCrossOriginRequest } from './lib/securityHeaders';

/** M12 CSP (security-policy.mjs): default-src 'self'; script-src 'self' 'unsafe-inline'; object-src 'none'. */

const isPublicRoute = createRouteMatcher([...MERLIN_PUBLIC_ROUTE_PATTERNS]);

/** Edge-safe CSRF seed so login/forms have a double-submit cookie before first POST. */
function generateCsrfTokenEdge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  // base64url without padding
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function ensureCsrfCookie(request: NextRequest, response: NextResponse): void {
  const existing = request.cookies.get(CSRF_COOKIE)?.value?.trim();
  if (existing && existing.length >= 16) return;
  const secure = isProductionRuntime();
  response.cookies.set(CSRF_COOKIE, generateCsrfTokenEdge(), {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
}

function denyCrossOriginApi(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/')) return null;

  const origin = request.headers.get('origin');
  if (!isCrossOriginRequest(origin, request.nextUrl.origin)) return null;

  const denied = new NextResponse(
    JSON.stringify({ error: 'Cross-origin API access is not permitted.' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  applySecurityHeaders(denied.headers, BASE_SECURITY_HEADERS);
  denied.headers.set('Vary', 'Origin');
  return denied;
}

function denyBootstrapSeedInProduction(request: NextRequest): NextResponse | null {
  if (!isProductionRuntime()) return null;
  if (request.nextUrl.pathname !== BOOTSTRAP_SEED_PATH) return null;

  logBootstrapSeedBlockedAttempt({ request, layer: 'middleware' });
  const denied = new NextResponse(
    JSON.stringify({ error: BOOTSTRAP_PRODUCTION_BLOCKED_MESSAGE }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  );
  applySecurityHeaders(denied.headers, BASE_SECURITY_HEADERS);
  return denied;
}

function applyMerlinSecurityHeaders(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();
  applySecurityHeaders(response.headers, BASE_SECURITY_HEADERS);
  response.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (isMerlinPublicPath(pathname) || isPublicRoute(request)) {
    response.headers.set('x-merlin-public-route', '1');
  }
  // Seed CSRF cookie for document navigations and API so mutations can double-submit.
  ensureCsrfCookie(request, response);
  return response;
}

function merlinMiddleware(request: NextRequest): NextResponse {
  const bootstrapDenied = denyBootstrapSeedInProduction(request);
  if (bootstrapDenied) return bootstrapDenied;

  const crossOriginDenied = denyCrossOriginApi(request);
  if (crossOriginDenied) return crossOriginDenied;

  return applyMerlinSecurityHeaders(request);
}

const middleware = isClerkAuthPathEnabled()
  ? clerkMiddleware(
      async (_auth, request) => {
        return merlinMiddleware(request);
      },
      {
        signInUrl: '/sign-in',
      }
    )
  : merlinMiddleware;

export default middleware;

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.json|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};