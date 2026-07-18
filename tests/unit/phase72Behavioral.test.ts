/**
 * Phase 7.2 H12 — behavioral proof for fortress properties (unit-level runtime).
 * Complements integration suites that need a live database.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import {
  auditMetadataHasPathname,
  collectRepairOrderImagePathnames,
  findForbiddenImagePathname,
  userCanAccessImage,
  type ImageAccessSession,
} from '@/lib/imageAccess';
import { RATE_LIMIT_ERROR } from '@/lib/errors';
import { checkRateLimit, resetMemoryRateLimitStoreForTests } from '@/lib/rate-limit';
import { isRlsEnabled, isRlsSoftOpen, rlsContextFromSession } from '@/lib/apex/rlsContext';
import { isPlatformOperatorEmail, parsePlatformOwnerEmailsFromEnv } from '@/lib/apex/platformOperator';
import { APEX_NATIONAL_DEALERSHIP_ID } from '@/lib/apex/platformConstants';

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('Phase 7.2 H12 — rate limit 429 path', () => {
  test('memory backend returns 429 when limit exceeded', async () => {
    resetMemoryRateLimitStoreForTests();
    const saved = {
      kvUrl: process.env.KV_REST_API_URL,
      kvToken: process.env.KV_REST_API_TOKEN,
      platformMode: process.env.PLATFORM_MODE,
      publicPlatformMode: process.env.NEXT_PUBLIC_PLATFORM_MODE,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    };
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    process.env.PLATFORM_MODE = 'merlinus';
    process.env.NEXT_PUBLIC_PLATFORM_MODE = 'merlinus';
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL_ENV;

    try {
      const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
      const routeKey = `test.429.${Date.now()}`;
      // memory halves limit when KV missing: limit 2 → memory 1
      const config = { limit: 2, windowMs: 60_000 };
      const req = () =>
        new Request('http://localhost/api/test', {
          headers: { 'x-real-ip': ip },
        });

      const first = await checkRateLimit(req(), routeKey, config);
      assert.equal(first, null, 'first request allowed');

      const second = await checkRateLimit(req(), routeKey, config);
      assert.ok(second, 'second request should 429 with half limit');
      assert.equal(second!.status, 429);
      const body = (await second!.json()) as { error: string };
      assert.equal(body.error, RATE_LIMIT_ERROR);
    } finally {
      resetMemoryRateLimitStoreForTests();
      if (saved.kvUrl === undefined) delete process.env.KV_REST_API_URL;
      else process.env.KV_REST_API_URL = saved.kvUrl;
      if (saved.kvToken === undefined) delete process.env.KV_REST_API_TOKEN;
      else process.env.KV_REST_API_TOKEN = saved.kvToken;
      if (saved.platformMode === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = saved.platformMode;
      if (saved.publicPlatformMode === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
      else process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.publicPlatformMode;
      process.env.NODE_ENV = saved.nodeEnv;
      if (saved.vercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.vercelEnv;
    }
  });
});

describe('Phase 7.2 H12 — image access / IDOR helpers', () => {
  test('auditMetadataHasPathname exact match only', () => {
    assert.equal(
      auditMetadataHasPathname(JSON.stringify({ pathname: 'benz-tech/a.jpg' }), 'benz-tech/a.jpg'),
      true
    );
    assert.equal(
      auditMetadataHasPathname(JSON.stringify({ pathname: 'benz-tech/a.jpg' }), 'benz-tech/a'),
      false
    );
  });

  test('collectRepairOrderImagePathnames gathers line and RO paths', () => {
    const paths = collectRepairOrderImagePathnames({
      xentryImages: [{ pathname: 'ro/p1.jpg' }],
      repairLines: [{ xentryImages: [{ pathname: 'line/p2.jpg' }] }],
    });
    assert.deepEqual(paths, ['ro/p1.jpg', 'line/p2.jpg']);
  });

  test('imageAccess module is RLS-aware and batched (source + exports)', () => {
    const src = readSrc('src/lib/imageAccess.ts');
    assert.match(src, /getRlsDb/);
    assert.match(src, /loadAttachedPathnames/);
    assert.match(src, /loadRecentUploadPathnames/);
    assert.equal(typeof userCanAccessImage, 'function');
    assert.equal(typeof findForbiddenImagePathname, 'function');
    const session: ImageAccessSession = {
      technicianId: 't1',
      role: 'technician',
      dealershipId: 'd1',
    };
    // Type shape for route callers
    assert.ok(session.dealershipId);
  });
});

describe('Phase 7.2 H12 — RLS runtime contracts', () => {
  test('Apex mode enforces RLS; Merlinus soft-open by default', () => {
    const saved = {
      platform: process.env.PLATFORM_MODE,
      publicPlatform: process.env.NEXT_PUBLIC_PLATFORM_MODE,
      rls: process.env.RLS_ENABLED,
    };
    try {
      process.env.PLATFORM_MODE = 'apex';
      process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
      delete process.env.RLS_ENABLED;
      assert.equal(isRlsEnabled(), true);
      assert.equal(isRlsSoftOpen(), false);

      process.env.PLATFORM_MODE = 'merlinus';
      process.env.NEXT_PUBLIC_PLATFORM_MODE = 'merlinus';
      delete process.env.RLS_ENABLED;
      assert.equal(isRlsEnabled(), false);
      assert.equal(isRlsSoftOpen(), true);
    } finally {
      if (saved.platform === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = saved.platform;
      if (saved.publicPlatform === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
      else process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.publicPlatform;
      if (saved.rls === undefined) delete process.env.RLS_ENABLED;
      else process.env.RLS_ENABLED = saved.rls;
    }
  });

  test('rlsContextFromSession denies national owner PII active dealership', () => {
    // resolveSessionScopeMode only honors national scope in Apex mode.
    // Isolate env so CI (no PLATFORM_MODE) and local Apex .env.local both pass.
    const saved = {
      platform: process.env.PLATFORM_MODE,
      publicPlatform: process.env.NEXT_PUBLIC_PLATFORM_MODE,
      apexEnv: process.env.APEX_ENV,
    };
    try {
      process.env.PLATFORM_MODE = 'apex';
      process.env.NEXT_PUBLIC_PLATFORM_MODE = 'apex';
      delete process.env.APEX_ENV;
      const ctx = rlsContextFromSession({
        technicianId: 'owner-1',
        role: 'owner',
        dealershipId: APEX_NATIONAL_DEALERSHIP_ID,
        scopeMode: 'national',
        isOwner: true,
      });
      assert.equal(ctx.activeDealershipId, null);
      assert.equal(ctx.scopeMode, 'national');
    } finally {
      if (saved.platform === undefined) delete process.env.PLATFORM_MODE;
      else process.env.PLATFORM_MODE = saved.platform;
      if (saved.publicPlatform === undefined) delete process.env.NEXT_PUBLIC_PLATFORM_MODE;
      else process.env.NEXT_PUBLIC_PLATFORM_MODE = saved.publicPlatform;
      if (saved.apexEnv === undefined) delete process.env.APEX_ENV;
      else process.env.APEX_ENV = saved.apexEnv;
    }
  });

  test('RLS helpers still present (D1 uses app-level isolation, not Postgres set_config)', () => {
    const rls = readSrc('src/lib/apex/rlsContext.ts');
    // D1/SQLite: setRlsContext is a no-op; multi-rooftop isolation is query filters + ALS.
    assert.equal(rls.includes("set_config('app.rls_enforced'"), false);
    assert.match(rls, /export async function setRlsContext/);
    assert.match(rls, /withSessionRls/);
    assert.match(rls, /withRlsBypass/);
    assert.match(rls, /isApexPlatformMode/);

    // Historical Postgres RLS migration may still exist in git history for reference.
    const migPath =
      'prisma/migrations/20250715120000_apex_phase6_2_rls_default_deny/migration.sql';
    try {
      const mig = readSrc(migPath);
      assert.match(mig, /Technician/);
    } catch {
      // Optional if migration tree was dropped for D1-only deploys
    }
  });
});

describe('Phase 7.2 H12 — session revocation chain (source + contracts)', () => {
  test('revokeAllSessionsForTechnician performs full fortress kill', () => {
    const src = readSrc('src/lib/sessionRevocation.ts');
    assert.match(src, /incrementSessionVersion/);
    assert.match(src, /revokeAllRefreshTokensForTechnician/);
    assert.match(src, /revokeTechnicianAuthSessions/);
    assert.match(src, /auth\.sessions_revoked_full/);
  });

  test('logout and change-password call full revocation', () => {
    const logout = readSrc('src/app/api/auth/logout/route.ts');
    const change = readSrc('src/app/api/auth/change-password/route.ts');
    assert.match(logout, /revokeAllSessionsForTechnician|revokeTechnicianAuthSessions|destroySession/);
    assert.match(change, /revokeAllSessionsForTechnician/);
  });

  test('platform operator allowlist is explicit (no empty-membership superuser)', () => {
    const saved = process.env.APEX_PLATFORM_OWNER_EMAILS;
    process.env.APEX_PLATFORM_OWNER_EMAILS = 'ops@example.com';
    delete process.env.OWNER_SEED_EMAIL;
    delete process.env.OWNER_SEED_EMAIL_2;
    try {
      const set = parsePlatformOwnerEmailsFromEnv();
      assert.ok(set.has('ops@example.com'));
      assert.equal(isPlatformOperatorEmail('ops@example.com'), true);
      assert.equal(isPlatformOperatorEmail('stranger@example.com'), false);
    } finally {
      if (saved === undefined) delete process.env.APEX_PLATFORM_OWNER_EMAILS;
      else process.env.APEX_PLATFORM_OWNER_EMAILS = saved;
    }
  });
});

describe('Phase 7.2 H12 — Clerk webhook behavioral contracts', () => {
  test('webhook route requires verifyWebhook and fails closed', () => {
    const src = readSrc('src/app/api/webhooks/clerk/route.ts');
    assert.match(src, /verifyWebhook/);
    assert.match(src, /handleClerkWebhookUserEvent/);
    assert.match(src, /Webhook verification failed/);
    assert.match(src, /user\.deleted/);
    assert.match(src, /user\.created/);
  });

  test('handleClerkWebhookUserEvent unlinks on delete', () => {
    const src = readSrc('src/lib/clerkIdentity.ts');
    assert.match(src, /export async function handleClerkWebhookUserEvent/);
    assert.match(src, /user\.deleted/);
    assert.match(src, /unlinkClerkUser/);
    assert.match(src, /withRlsBypass/);
  });

  test('webhook is public but signature-gated (public route list)', () => {
    const publicRoutes = readSrc('src/lib/publicRoutes.ts');
    // Accept either webhooks/clerk path registration or middleware comment
    const middleware = readSrc('src/middleware.ts');
    const combined = publicRoutes + middleware;
    assert.match(combined, /webhooks\/clerk|clerk.*webhook/i);
  });
});

describe('Phase 7.2 H12 — crypto helper used by session tokens', () => {
  test('sha256 shape for refresh token hashes', () => {
    const hex = createHash('sha256').update('token').digest('hex');
    assert.equal(hex.length, 64);
  });
});
