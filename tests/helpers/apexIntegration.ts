import { NextRequest, NextResponse } from 'next/server';
import { APEX_ACCESS_COOKIE } from '../../src/lib/apex/apexSession';

export const INTEGRATION_OWNER_EMAIL = 'owner.integration@apex.seed.local';
export const INTEGRATION_OWNER_PASSWORD = 'integration-owner-seed-password';
export const INTEGRATION_MULTI_USERNAME = 'mercedes.alex.integration';
export const INTEGRATION_MULTI_PASSWORD = 'integration-multi-rooftop-password';

export function applyApexIntegrationSeedEnv(): void {
  process.env.OWNER_SEED_EMAIL = INTEGRATION_OWNER_EMAIL;
  process.env.OWNER_SEED_PASSWORD = INTEGRATION_OWNER_PASSWORD;
  process.env.OWNER_SEED_NAME = 'Integration National Owner';
  process.env.MULTI_ROOFTOP_SEED_USERNAME = INTEGRATION_MULTI_USERNAME;
  process.env.MULTI_ROOFTOP_SEED_PASSWORD = INTEGRATION_MULTI_PASSWORD;
  process.env.MULTI_ROOFTOP_SEED_NAME = 'Integration Multi-Rooftop Tech';
}

export function enableApexPlatformModeForTests(): string | undefined {
  const previous = process.env.PLATFORM_MODE;
  process.env.PLATFORM_MODE = 'apex';
  return previous;
}

/**
 * Merlinus integration suites mint benz_tech_session JWTs.
 * When local .env.local has PLATFORM_MODE=apex (or a prior suite left it set),
 * resolvePlatformSessionContext ignores those cookies and returns 401.
 * Force merlinus for the duration of legacy-cookie suites.
 */
export function enableMerlinusPlatformModeForTests(): string | undefined {
  const previous = process.env.PLATFORM_MODE;
  process.env.PLATFORM_MODE = 'merlinus';
  return previous;
}

export function restorePlatformMode(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.PLATFORM_MODE;
  } else {
    process.env.PLATFORM_MODE = previous;
  }
}

export function buildApexAuthenticatedRequest(
  url: string,
  accessToken: string,
  options: { method?: string; body?: unknown } = {}
): NextRequest {
  const headers = new Headers({
    Cookie: `${APEX_ACCESS_COOKIE}=${accessToken}`,
  });

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  return new NextRequest(url, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export function extractApexAccessCookie(
  response: NextResponse | Response
): string | undefined {
  const cookies = (response as NextResponse).cookies;
  if (cookies?.get) {
    return cookies.get(APEX_ACCESS_COOKIE)?.value;
  }
  return undefined;
}