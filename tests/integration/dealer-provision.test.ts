/**
 * PR-P4 â€” dealer provision integration (CLI core + HTTP owner API + forced password gate).
 */
import '../setup/criticalPathMocks';

import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { POST as postChangePassword } from '../../src/app/api/auth/change-password/route';
import { POST as postLogin } from '../../src/app/api/auth/login/route';
import { POST as postProvisionDealer } from '../../src/app/api/owner/provision-dealer/route';
import { GET as getRepairOrders } from '../../src/app/api/repair-orders/route';
import {
  provisionDealer,
  type ProvisionDealerResult,
} from '../../src/lib/apex/provisionDealer';
import { seedApexOwnerAccounts } from '../../src/lib/apex/seedOwnerAccounts';
import {
  applyApexIntegrationSeedEnv,
  buildApexAuthenticatedRequest,
  enableApexPlatformModeForTests,
  extractApexAccessCookie,
  INTEGRATION_OWNER_EMAIL,
  INTEGRATION_OWNER_PASSWORD,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { readJsonResponse } from '../helpers/routeTest';
import { clearCriticalPathMocks, runWithNextRouteContext } from '../setup/criticalPathMocks';
import { createTestPrismaClient } from '../setup/prismaNode.mjs';

const prisma = createTestPrismaClient();

const TEMP_PASSWORD = 'Integ-Temp-Pass-9x7k';
const NEW_PASSWORD = 'Integ-New-Pass-4m2q';

function uniqueSuffix(): string {
  return Date.now().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6);
}

async function cleanupDealerCode(dealerCode: string): Promise<void> {
  const dealer = await prisma.dealer.findUnique({ where: { code: dealerCode } });
  if (!dealer) return;

  const dealerships = await prisma.dealership.findMany({
    where: { dealerId: dealer.id },
    select: { id: true },
  });
  const dealershipIds = dealerships.map((d) => d.id);

  if (dealershipIds.length > 0) {
    await prisma.technicianDealership.deleteMany({
      where: { dealershipId: { in: dealershipIds } },
    });
    const techs = await prisma.technician.findMany({
      where: { dealershipId: { in: dealershipIds } },
      select: { id: true },
    });
    const techIds = techs.map((t) => t.id);
    if (techIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { technicianId: { in: techIds } } });
    }
    await prisma.auditLog.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
    await prisma.technician.deleteMany({ where: { dealershipId: { in: dealershipIds } } });
    await prisma.dealership.deleteMany({ where: { id: { in: dealershipIds } } });
  }

  await prisma.auditLog.deleteMany({ where: { dealerId: dealer.id } });
  await prisma.dealer.delete({ where: { id: dealer.id } }).catch(() => undefined);
}

describe('Dealer provision system (PR-P4)', () => {
  let previousPlatformMode: string | undefined;
  let previousHttpFlag: string | undefined;
  let ownerAccessToken = '';
  const codesToCleanup: string[] = [];

  before(async () => {
    previousPlatformMode = enableApexPlatformModeForTests();
    previousHttpFlag = process.env.APEX_ALLOW_HTTP_PROVISION;
    applyApexIntegrationSeedEnv();

    // Ensure provision columns exist. Postgres supports IF NOT EXISTS; SQLite/D1 does not.
    // Current Prisma schema already includes these fields â€” skip raw DDL on SQLite.
    const dbUrl = process.env.DATABASE_URL ?? '';
    const isSqlite = dbUrl.startsWith('file:') || dbUrl.includes('sqlite') || !dbUrl.includes('postgres');
    if (!isSqlite) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Technician" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false'
      );
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "Technician" ADD COLUMN IF NOT EXISTS "password_changed_at" TIMESTAMP(3)'
      );
    }

    await prisma.dealership.upsert({
      where: { id: 'seed-dealership' },
      update: { name: 'Mercedes-Benz of Tiverton' },
      create: { id: 'seed-dealership', name: 'Mercedes-Benz of Tiverton' },
    });

    await seedApexOwnerAccounts({
      owners: [
        {
          email: INTEGRATION_OWNER_EMAIL,
          password: INTEGRATION_OWNER_PASSWORD,
          name: 'Integration National Owner',
        },
      ],
    });

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
    for (const code of codesToCleanup) {
      await cleanupDealerCode(code);
    }
    if (previousHttpFlag === undefined) {
      delete process.env.APEX_ALLOW_HTTP_PROVISION;
    } else {
      process.env.APEX_ALLOW_HTTP_PROVISION = previousHttpFlag;
    }
    restorePlatformMode(previousPlatformMode);
    clearCriticalPathMocks();
    await prisma.$disconnect();
  });

  test('CLI core provisionDealer creates dealer, rooftop, manager with mustChangePassword', async () => {
    const suffix = uniqueSuffix();
    const dealerCode = `CLP${suffix}`;
    codesToCleanup.push(dealerCode);
    const d7 = `D7CL${suffix}`.slice(0, 16);
    const email = `cli.${dealerCode.toLowerCase()}@provision.int.test`;

    const result: ProvisionDealerResult = await provisionDealer({
      dealerCode,
      dealerName: 'CLI Integration Franchise',
      rooftopName: 'CLI Integration Motors of Riverside',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'CLI Manager',
        email,
        password: TEMP_PASSWORD,
        d7Number: d7,
      },
      actor: { type: 'script', id: 'integration-cli' },
    });

    assert.equal(result.created, true);
    assert.equal(result.mustChangePassword, true);
    assert.equal(result.rooftopName, 'CLI Integration Motors of Riverside');
    assert.ok(result.auditLogId);

    const manager = await prisma.technician.findUnique({ where: { id: result.managerId } });
    assert.ok(manager);
    assert.equal(manager!.mustChangePassword, true);
    assert.equal(manager!.role, 'manager');
    assert.equal(manager!.d7Number, d7);

    const audit = await prisma.auditLog.findUnique({ where: { id: result.auditLogId! } });
    assert.ok(audit);
    assert.equal(audit!.action, 'dealer.provision');
    const meta = JSON.parse(audit!.metadata || '{}') as Record<string, unknown>;
    assert.equal(typeof meta.dealerCodeHash, 'string');
    assert.equal(meta.outcome, 'created');
    assert.equal('password' in meta, false);
    assert.equal('email' in meta, false);
    assert.equal('rooftopName' in meta, false);
    assert.notEqual(meta.dealerCodeHash, dealerCode);

    // Dry-run does not write
    const dry = await provisionDealer({
      dealerCode: `DRY${suffix}`,
      dealerName: 'Dry Franchise',
      rooftopName: 'Dry Run Motors of Lakeside',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Dry Manager',
        email: `dry.${suffix}@provision.int.test`,
        password: TEMP_PASSWORD,
        d7Number: `D7DR${suffix}`.slice(0, 16),
      },
      dryRun: true,
      actor: { type: 'script', id: 'integration-dry' },
    });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.created, false);
    assert.equal(await prisma.dealer.findUnique({ where: { code: `DRY${suffix}` } }), null);
  });

  test('HTTP provision disabled without APEX_ALLOW_HTTP_PROVISION=true', async () => {
    delete process.env.APEX_ALLOW_HTTP_PROVISION;

    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/provision-dealer', ownerAccessToken, {
        method: 'POST',
        body: {
          dealerCode: 'DISABLED1',
          confirmDealerCode: 'DISABLED1',
          dealerName: 'Should Not Create',
          rooftopName: 'Should Not Create Motors',
          templateId: 'mercedes-rooftop-v1',
          manager: {
            name: 'Nope',
            email: 'nope@provision.int.test',
            password: TEMP_PASSWORD,
            d7Number: 'D7DISABLED1',
          },
        },
      }),
      '/api/owner/provision-dealer/route',
      (req) => postProvisionDealer(req)
    );

    const { status, body } = await readJsonResponse<{ code?: string; error?: string }>(response);
    assert.equal(status, 403);
    assert.equal(body.code, 'HTTP_PROVISION_DISABLED');
  });

  test('HTTP provision (enabled) provisions rooftop and never returns password', async () => {
    process.env.APEX_ALLOW_HTTP_PROVISION = 'true';

    const suffix = uniqueSuffix();
    const dealerCode = `HTP${suffix}`;
    codesToCleanup.push(dealerCode);
    const d7 = `D7HT${suffix}`.slice(0, 16);
    const email = `http.${dealerCode.toLowerCase()}@provision.int.test`;

    const response = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/provision-dealer', ownerAccessToken, {
        method: 'POST',
        body: {
          dealerCode,
          confirmDealerCode: dealerCode,
          dealerName: 'HTTP Integration Franchise',
          rooftopName: 'HTTP Integration Motors of Oak',
          templateId: 'mercedes-rooftop-v1',
          manager: {
            name: 'HTTP Manager',
            email,
            password: TEMP_PASSWORD,
            d7Number: d7,
          },
        },
      }),
      '/api/owner/provision-dealer/route',
      (req) => postProvisionDealer(req)
    );

    const { status, body } = await readJsonResponse<{
      created?: boolean;
      mustChangePassword?: boolean;
      rooftopName?: string;
      managerId?: string;
      logins?: Array<{ identifierType: string; identifier?: string }>;
      password?: string;
      error?: string;
      code?: string;
    }>(response);

    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.created, true);
    assert.equal(body.mustChangePassword, true);
    assert.equal(body.rooftopName, 'HTTP Integration Motors of Oak');
    assert.equal(body.password, undefined);
    assert.ok(body.logins?.[0]?.identifierType === 'd7');
    assert.equal(body.logins?.[0]?.identifier, undefined);

    const raw = JSON.stringify(body);
    assert.doesNotMatch(raw, /"password"\s*:/);
    assert.doesNotMatch(raw, new RegExp(TEMP_PASSWORD));

    // Confirm mismatch rejected
    const badConfirm = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/owner/provision-dealer', ownerAccessToken, {
        method: 'POST',
        body: {
          dealerCode: `BAD${suffix}`,
          confirmDealerCode: 'NOPE',
          dealerName: 'Bad Confirm Franchise',
          rooftopName: 'Bad Confirm Motors of West',
          templateId: 'mercedes-rooftop-v1',
          manager: {
            name: 'Bad',
            email: `bad.${suffix}@provision.int.test`,
            password: TEMP_PASSWORD,
            d7Number: `D7BD${suffix}`.slice(0, 16),
          },
        },
      }),
      '/api/owner/provision-dealer/route',
      (req) => postProvisionDealer(req)
    );
    assert.equal(badConfirm.status, 400);
  });

  test('forced password gate blocks PII until change-password', async () => {
    const suffix = uniqueSuffix();
    const dealerCode = `PWG${suffix}`;
    codesToCleanup.push(dealerCode);
    const d7 = `D7PW${suffix}`.slice(0, 16);
    const email = `pwg.${dealerCode.toLowerCase()}@provision.int.test`;

    const provisioned = await provisionDealer({
      dealerCode,
      dealerName: 'Password Gate Franchise',
      rooftopName: 'Password Gate Motors of North',
      templateId: 'mercedes-rooftop-v1',
      manager: {
        name: 'Gate Manager',
        email,
        password: TEMP_PASSWORD,
        d7Number: d7,
      },
      actor: { type: 'script', id: 'integration-pw-gate' },
    });
    assert.equal(provisioned.created, true);

    const loginResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: d7, password: TEMP_PASSWORD }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );
    const login = await readJsonResponse<{
      session?: { mustChangePassword?: boolean; name?: string };
      error?: string;
    }>(loginResponse);
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.equal(login.body.session?.mustChangePassword, true);

    const managerToken = extractApexAccessCookie(loginResponse) ?? '';
    assert.ok(managerToken);

    const roList = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', managerToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );
    const blocked = await readJsonResponse<{ code?: string }>(roList);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');

    const changeResponse = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/auth/change-password', managerToken, {
        method: 'POST',
        body: { currentPassword: TEMP_PASSWORD, newPassword: NEW_PASSWORD },
      }),
      '/api/auth/change-password/route',
      (req) => postChangePassword(req)
    );
    const changed = await readJsonResponse<{ ok?: boolean; requiresReauth?: boolean }>(changeResponse);
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.ok, true);
    assert.equal(changed.body.requiresReauth, true);

    const manager = await prisma.technician.findUnique({ where: { id: provisioned.managerId } });
    assert.equal(manager?.mustChangePassword, false);

    const reLoginResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: d7, password: NEW_PASSWORD }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );
    const reLogin = await readJsonResponse<{ session?: { mustChangePassword?: boolean } }>(
      reLoginResponse
    );
    assert.equal(reLogin.status, 200, JSON.stringify(reLogin.body));
    assert.equal(reLogin.body.session?.mustChangePassword, false);

    const newToken = extractApexAccessCookie(reLoginResponse) ?? '';
    assert.ok(newToken);

    const roAfter = await runWithNextRouteContext(
      buildApexAuthenticatedRequest('http://localhost/api/repair-orders', newToken),
      '/api/repair-orders/route',
      (req) => getRepairOrders(req)
    );
    assert.equal(roAfter.status, 200, 'PII routes available after password change');
  });
});
