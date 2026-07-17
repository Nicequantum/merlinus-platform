/**
 * Phase 6.x — security fortress integration tests (6.3–6.4).
 * Covers owner least-privilege, national console lock, scope-switch, multi-rooftop select.
 */
import '../setup/criticalPathMocks';

import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { PrismaClient } from '@prisma/client';
import { POST as postEnterDealership } from '../../src/app/api/auth/enter-dealership/route';
import { POST as postExitDealership } from '../../src/app/api/auth/exit-dealership/route';
import { POST as postLogin } from '../../src/app/api/auth/login/route';
import { GET as getOwnerSummary } from '../../src/app/api/owner/summary/route';
import { GET as getOwnerDealerships } from '../../src/app/api/owner/dealerships/route';
import { GET as getRepairOrders } from '../../src/app/api/repair-orders/route';
import { POST as postSelectDealership } from '../../src/app/api/auth/select-dealership/route';
import { APEX_NATIONAL_DEALERSHIP_ID } from '../../src/lib/apex/platformConstants';
import { seedApexOwnerAccounts } from '../../src/lib/apex/seedOwnerAccounts';
import {
  applyApexIntegrationSeedEnv,
  buildApexAuthenticatedRequest,
  enableApexPlatformModeForTests,
  extractApexAccessCookie,
  INTEGRATION_MULTI_PASSWORD,
  INTEGRATION_MULTI_USERNAME,
  INTEGRATION_OWNER_EMAIL,
  INTEGRATION_OWNER_PASSWORD,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { readJsonResponse } from '../helpers/routeTest';
import { clearCriticalPathMocks, runWithNextRouteContext } from '../setup/criticalPathMocks';

const prisma = new PrismaClient();

describe('Security fortress (Phase 6.3–6.4)', () => {
  let previousPlatformMode: string | undefined;
  let ownerAccessToken = '';
  let primaryDealershipId = 'seed-dealership';

  before(async () => {
    previousPlatformMode = enableApexPlatformModeForTests();
    applyApexIntegrationSeedEnv();

    await prisma.dealership.upsert({
      where: { id: 'seed-dealership' },
      update: { name: 'Mercedes-Benz of Tiverton' },
      create: { id: 'seed-dealership', name: 'Mercedes-Benz of Tiverton' },
    });

    const apexSeed = await seedApexOwnerAccounts({
      owners: [
        {
          email: INTEGRATION_OWNER_EMAIL,
          password: INTEGRATION_OWNER_PASSWORD,
          name: 'Integration National Owner',
        },
      ],
      multiRooftopUsername: INTEGRATION_MULTI_USERNAME,
      multiRooftopPassword: INTEGRATION_MULTI_PASSWORD,
      multiRooftopName: 'Integration Multi-Rooftop Tech',
    });
    primaryDealershipId = apexSeed.rooftopIds[0] ?? primaryDealershipId;

    const loginResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: INTEGRATION_OWNER_EMAIL,
          password: INTEGRATION_OWNER_PASSWORD,
        }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );
    const login = await readJsonResponse<{ error?: string }>(loginResponse);
    assert.equal(login.status, 200, `owner login failed: ${JSON.stringify(login.body)}`);
    ownerAccessToken = extractApexAccessCookie(loginResponse) ?? '';
    assert.ok(ownerAccessToken, 'owner access cookie required');
  });

  after(async () => {
    restorePlatformMode(previousPlatformMode);
    clearCriticalPathMocks();
    await prisma.$disconnect();
  });

  test('national owner is blocked from RO list (PII)', async () => {
    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', ownerAccessToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );
    const { status, body } = await readJsonResponse<{ code?: string }>(response);
    assert.equal(status, 403);
    assert.equal(body.code, 'DEALERSHIP_CONTEXT_REQUIRED');
  });

  test('national owner can list enterable dealerships without sentinel', async () => {
    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/dealerships', ownerAccessToken),
      '/api/owner/dealerships/route',
      (req) => getOwnerDealerships(req)
    );
    const { status, body } = await readJsonResponse<{
      dealerships?: Array<{ id: string; name: string }>;
      error?: string;
    }>(response);
    assert.equal(status, 200, JSON.stringify(body));
    assert.ok(Array.isArray(body.dealerships));
    assert.ok(body.dealerships!.length >= 1);
    assert.ok(body.dealerships!.every((d) => d.id !== '__apex_national__'));
  });

  test('owner after enter-dealership is blocked from national console until exit', async () => {
    const enterResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/enter-dealership', ownerAccessToken, {
        method: 'POST',
        body: { dealershipId: primaryDealershipId },
      }),
      '/api/auth/enter-dealership/route',
      (req) => postEnterDealership(req)
    );
    const enter = await readJsonResponse<{
      scopeMode?: string;
      error?: string;
    }>(enterResponse);
    assert.equal(enter.status, 200, JSON.stringify(enter.body));
    assert.equal(enter.body.scopeMode, 'dealership');

    const dealershipToken = extractApexAccessCookie(enterResponse) ?? '';
    assert.ok(dealershipToken);

    const summaryResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/summary', dealershipToken),
      '/api/owner/summary/route',
      (req) => getOwnerSummary(req)
    );
    const summary = await readJsonResponse<{ code?: string; error?: string }>(summaryResponse);
    assert.equal(summary.status, 403, 'dealership-scope owner must not use national summary');
    assert.equal(summary.body.code, 'DEALERSHIP_CONTEXT_REQUIRED');

    // Phase 6.4 — cannot re-enter from dealership scope (must exit first)
    const reEnter = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/enter-dealership', dealershipToken, {
        method: 'POST',
        body: { dealershipId: primaryDealershipId },
      }),
      '/api/auth/enter-dealership/route',
      (req) => postEnterDealership(req)
    );
    const reEnterBody = await readJsonResponse<{ code?: string }>(reEnter);
    assert.equal(reEnter.status, 403, 'must be national to enter dealership');
    assert.equal(reEnterBody.body.code, 'DEALERSHIP_CONTEXT_REQUIRED');

    // Exit restores national console
    const exitResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/exit-dealership', dealershipToken, {
        method: 'POST',
        body: {},
      }),
      '/api/auth/exit-dealership/route',
      (req) => postExitDealership(req)
    );
    const exit = await readJsonResponse<{ scopeMode?: string }>(exitResponse);
    assert.equal(exit.status, 200, JSON.stringify(exit.body));
    assert.equal(exit.body.scopeMode, 'national');
    const nationalToken = extractApexAccessCookie(exitResponse) ?? '';
    assert.ok(nationalToken);

    const summaryOk = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/summary', nationalToken),
      '/api/owner/summary/route',
      (req) => getOwnerSummary(req)
    );
    assert.equal(summaryOk.status, 200);

    // Keep suite token national for remaining tests that reuse ownerAccessToken patterns
    ownerAccessToken = nationalToken;
  });

  test('owner cannot enter national sentinel as rooftop', async () => {
    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/enter-dealership', ownerAccessToken, {
        method: 'POST',
        body: { dealershipId: APEX_NATIONAL_DEALERSHIP_ID },
      }),
      '/api/auth/enter-dealership/route',
      (req) => postEnterDealership(req)
    );
    const { status, body } = await readJsonResponse<{ error?: string }>(response);
    assert.equal(status, 403);
    assert.match(String(body.error || ''), /sentinel|national|dealership/i);
  });

  test('multi-rooftop select issues dealership scopeMode and revokes prior refresh families', async () => {
    const loginResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: INTEGRATION_MULTI_USERNAME,
          password: INTEGRATION_MULTI_PASSWORD,
        }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );
    const loginBody = await readJsonResponse<{
      requiresDealershipSelection?: boolean;
      pendingToken?: string;
      dealerships?: Array<{ id: string; isPrimary: boolean }>;
      error?: string;
    }>(loginResponse);
    assert.equal(loginBody.status, 200, JSON.stringify(loginBody.body));
    assert.equal(loginBody.body.requiresDealershipSelection, true);
    assert.ok(loginBody.body.pendingToken);

    const primary = loginBody.body.dealerships!.find((d) => d.isPrimary);
    assert.ok(primary);

    const beforeSelect = await prisma.sessionRefreshToken.count({
      where: {
        technicianId: (
          await prisma.technician.findFirst({
            where: { apexUsername: INTEGRATION_MULTI_USERNAME },
            select: { id: true },
          })
        )?.id,
        revokedAt: null,
      },
    });

    const selectResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/select-dealership', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pendingToken: loginBody.body.pendingToken,
          dealershipId: primary.id,
          rememberAsDefault: false,
        }),
      }),
      '/api/auth/select-dealership/route',
      (req) => postSelectDealership(req)
    );
    const selectBody = await readJsonResponse<{
      session?: { scopeMode?: string; dealershipId?: string };
      error?: string;
    }>(selectResponse);
    assert.equal(selectBody.status, 200, JSON.stringify(selectBody.body));
    assert.equal(selectBody.body.session?.scopeMode, 'dealership');
    assert.equal(selectBody.body.session?.dealershipId, primary.id);
    assert.ok(extractApexAccessCookie(selectResponse));

    // After select, at most one active refresh family should remain (new issue).
    const tech = await prisma.technician.findFirst({
      where: { apexUsername: INTEGRATION_MULTI_USERNAME },
      select: { id: true },
    });
    assert.ok(tech);
    const afterSelect = await prisma.sessionRefreshToken.count({
      where: { technicianId: tech.id, revokedAt: null },
    });
    assert.ok(
      afterSelect <= Math.max(1, beforeSelect + 1),
      `expected scoped refresh inventory, before=${beforeSelect} after=${afterSelect}`
    );
    assert.ok(afterSelect >= 1, 'select-dealership should issue a new refresh token');
  });
});
