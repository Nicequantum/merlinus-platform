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
import { POST as postSelectDealership } from '../../src/app/api/auth/select-dealership/route';
import { GET as getOwnerSummary } from '../../src/app/api/owner/summary/route';
import { GET as getRepairOrders } from '../../src/app/api/repair-orders/route';
import { APEX_SEED_SECOND_DEALERSHIP_ID } from '../../src/lib/apex/seedOwnerAccounts';
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

describe('Apex owner + multi-rooftop HTTP flows (Phase 5.10)', () => {
  let previousPlatformMode: string | undefined;
  let ownerId = '';
  let primaryDealershipId = 'seed-dealership';
  let ownerAccessToken = '';

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
    ownerId = apexSeed.ownerId;
    primaryDealershipId = apexSeed.rooftopIds[0] ?? primaryDealershipId;
  });

  after(async () => {
    restorePlatformMode(previousPlatformMode);
    clearCriticalPathMocks();
    await prisma.$disconnect();
  });

  test('owner email login returns national scope and apex access cookie', async () => {
    const response = await runWithNextRouteContext(
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

    const { status, body } = await readJsonResponse<{
      session?: {
        technicianId: string;
        role: string;
        scopeMode?: string;
        isOwner?: boolean;
      };
      error?: string;
    }>(response);

    assert.equal(status, 200, `owner login failed: ${JSON.stringify(body)}`);
    assert.equal(body.session?.technicianId, ownerId);
    assert.equal(body.session?.role, 'owner');
    assert.equal(body.session?.scopeMode, 'national');
    assert.equal(body.session?.isOwner, true);

    ownerAccessToken = extractApexAccessCookie(response) ?? '';
    assert.ok(ownerAccessToken, 'owner login should set apex_access cookie');
  });

  test('GET /api/owner/summary returns aggregates without PII fields', async () => {
    assert.ok(ownerAccessToken, 'owner access token required from login test');

    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/summary', ownerAccessToken),
      '/api/owner/summary/route',
      (req) => getOwnerSummary(req)
    );

    const { status, body } = await readJsonResponse<{
      dealerCount?: number;
      dealershipCount?: number;
      activeUsers?: number;
      repairOrdersLast7Days?: number;
      recentActivity?: Array<{ action: string; dealershipName: string | null }>;
      customerName?: string;
      technicianName?: string;
      roNumber?: string;
      error?: string;
    }>(response);

    assert.equal(status, 200, `owner summary failed: ${JSON.stringify(body)}`);
    assert.equal(typeof body.dealerCount, 'number');
    assert.equal(typeof body.dealershipCount, 'number');
    assert.equal(typeof body.activeUsers, 'number');
    assert.equal(typeof body.repairOrdersLast7Days, 'number');
    assert.ok(Array.isArray(body.recentActivity));
    assert.equal(body.customerName, undefined);
    assert.equal(body.technicianName, undefined);
    assert.equal(body.roNumber, undefined);
  });

  test('owner in national scope is blocked from dealership PII routes', async () => {
    assert.ok(ownerAccessToken);

    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', ownerAccessToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );

    const { status, body } = await readJsonResponse<{ code?: string; error?: string }>(response);
    assert.equal(status, 403);
    assert.equal(body.code, 'DEALERSHIP_CONTEXT_REQUIRED');
  });

  test('enter dealership grants PII access; exit returns to national scope', async () => {
    assert.ok(ownerAccessToken);

    const enterResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/enter-dealership', ownerAccessToken, {
        method: 'POST',
        body: { dealershipId: primaryDealershipId },
      }),
      '/api/auth/enter-dealership/route',
      (req) => postEnterDealership(req)
    );

    const { status: enterStatus, body: enterPayload } = await readJsonResponse<{
      session?: { scopeMode?: string; activeDealershipId?: string };
      scopeMode?: string;
      error?: string;
    }>(enterResponse);

    assert.equal(enterStatus, 200, `enter failed: ${JSON.stringify(enterPayload)}`);
    assert.equal(enterPayload.scopeMode, 'dealership');
    assert.equal(enterPayload.session?.scopeMode, 'dealership');
    assert.equal(enterPayload.session?.activeDealershipId, primaryDealershipId);

    const dealershipToken = extractApexAccessCookie(enterResponse) ?? '';
    assert.ok(dealershipToken, 'enter-dealership should re-issue apex_access cookie');

    const listResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', dealershipToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );
    const listBody = await readJsonResponse<{ repairOrders?: unknown[]; error?: string }>(listResponse);
    assert.equal(listBody.status, 200, `RO list in dealership scope failed: ${JSON.stringify(listBody.body)}`);
    assert.ok(Array.isArray(listBody.body.repairOrders));

    const exitResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/exit-dealership', dealershipToken, {
        method: 'POST',
      }),
      '/api/auth/exit-dealership/route',
      (req) => postExitDealership(req)
    );

    const { status: exitStatus, body: exitPayload } = await readJsonResponse<{
      session?: { scopeMode?: string };
      scopeMode?: string;
      error?: string;
    }>(exitResponse);

    assert.equal(exitStatus, 200, `exit failed: ${JSON.stringify(exitPayload)}`);
    assert.equal(exitPayload.scopeMode, 'national');
    assert.equal(exitPayload.session?.scopeMode, 'national');

    const nationalToken = extractApexAccessCookie(exitResponse) ?? '';
    assert.ok(nationalToken, 'exit-dealership should re-issue apex_access cookie');

    const blockedAgain = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', nationalToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );
    const blockedBody = await readJsonResponse<{ code?: string }>(blockedAgain);
    assert.equal(blockedBody.status, 403);
    assert.equal(blockedBody.body.code, 'DEALERSHIP_CONTEXT_REQUIRED');
  });

  test('multi-rooftop apex username login requires dealership selection', async () => {
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
      dealerships?: Array<{ id: string; name: string; isPrimary: boolean }>;
      session?: unknown;
      error?: string;
    }>(loginResponse);

    assert.equal(loginBody.status, 200, `multi login failed: ${JSON.stringify(loginBody.body)}`);
    assert.equal(loginBody.body.requiresDealershipSelection, true);
    assert.ok(loginBody.body.pendingToken);
    assert.ok(loginBody.body.dealerships && loginBody.body.dealerships.length >= 2);
    assert.equal(loginBody.body.session, undefined);

    const primary = loginBody.body.dealerships!.find((d) => d.isPrimary);
    assert.ok(primary);

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
      session?: { dealershipId: string; scopeMode?: string };
      error?: string;
    }>(selectResponse);

    assert.equal(selectBody.status, 200, `select failed: ${JSON.stringify(selectBody.body)}`);
    assert.equal(selectBody.body.session?.dealershipId, primary.id);
    assert.equal(selectBody.body.session?.scopeMode, 'dealership');

    const multiToken = extractApexAccessCookie(selectResponse) ?? '';
    assert.ok(multiToken, 'select-dealership should set apex_access cookie');

    const altDealership = loginBody.body.dealerships!.find((d) => d.id === APEX_SEED_SECOND_DEALERSHIP_ID);
    assert.ok(altDealership, 'second seed rooftop should be in selector list');
  });
});