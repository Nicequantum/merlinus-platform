import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}
import bcrypt from 'bcryptjs';
import { POST as postConsent } from '../../src/app/api/consent/route';
import { POST as postExtract } from '../../src/app/api/repair-orders/extract/route';
import { POST as postGenerateStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route';
import { GET as getRepairOrder } from '../../src/app/api/repair-orders/[id]/route';
import { GET as listRepairOrders } from '../../src/app/api/repair-orders/route';
import { createSessionToken } from '../../src/lib/auth';
import { CONSENT_REQUIRED_ERROR } from '../../src/lib/errors';
import { repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '../../src/types';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { createCompliantSessionToken } from '../helpers/integrationCompliance';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';
import { createTestPrismaClient } from '../setup/prismaNode.mjs';

const prisma = createTestPrismaClient();

const integrationOnboarding = {
  consentAt: new Date(),
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: new Date(),
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
};

describe('tenant isolation (route handlers)', () => {
  let previousPlatformMode: string | undefined;
  let dealershipAId = '';
  let dealershipBId = '';
  let techAId = '';
  let techBId = '';
  let techAToken = '';
  let techBToken = '';
  let managerBToken = '';
  let techNoConsentToken = '';
  let roAId = '';
  let lineAId = '';
  const privatePathname = 'benz-tech/tenant-isolation-private.jpg';

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    // Synthetic tenant fixtures â€” never use seed/default passwords in source (H11).
    const integrationPassword =
      process.env.INTEGRATION_TEST_PASSWORD?.trim() || `tenant-isolation-${Date.now()}`;
    const passwordHash = await bcrypt.hash(integrationPassword, 12);

    const dealershipA = await prisma.dealership.upsert({
      where: { id: 'tenant-test-a' },
      update: {},
      create: { id: 'tenant-test-a', name: 'Tenant Test Dealership A' },
    });
    dealershipAId = dealershipA.id;

    const dealershipB = await prisma.dealership.upsert({
      where: { id: 'tenant-test-b' },
      update: {},
      create: { id: 'tenant-test-b', name: 'Tenant Test Dealership B' },
    });
    dealershipBId = dealershipB.id;

    const readyAccount = {
      isActive: true as const,
      deletedAt: null as Date | null,
      mustChangePassword: false,
      isAdmin: false,
      ...integrationOnboarding,
    };

    const techA = await prisma.technician.upsert({
      where: { d7Number: 'D7TENANTA' },
      update: { dealershipId: dealershipAId, ...readyAccount },
      create: {
        d7Number: 'D7TENANTA',
        email: 'd7tenanta@benz-tech.local',
        name: 'Tenant Tech A',
        passwordHash,
        role: 'technician',
        dealershipId: dealershipAId,
        ...readyAccount,
      },
    });
    techAId = techA.id;

    const techB = await prisma.technician.upsert({
      where: { d7Number: 'D7TENANTB' },
      update: { dealershipId: dealershipBId, ...readyAccount },
      create: {
        d7Number: 'D7TENANTB',
        email: 'd7tenantb@benz-tech.local',
        name: 'Tenant Tech B',
        passwordHash,
        role: 'technician',
        dealershipId: dealershipBId,
        ...readyAccount,
      },
    });
    techBId = techB.id;

    const managerB = await prisma.technician.upsert({
      where: { d7Number: 'D7TENMGRB' },
      update: { dealershipId: dealershipBId, ...readyAccount },
      create: {
        d7Number: 'D7TENMGRB',
        email: 'd7tenmgrb@benz-tech.local',
        name: 'Tenant Manager B',
        passwordHash,
        role: 'manager',
        dealershipId: dealershipBId,
        ...readyAccount,
      },
    });

    const techNoConsent = await prisma.technician.upsert({
      where: { d7Number: 'D7TENNOCN' },
      update: {
        dealershipId: dealershipAId,
        isActive: true,
        deletedAt: null,
        mustChangePassword: false,
        isAdmin: false,
        consentAt: null,
        consentVersion: null,
        legalDisclaimerAt: null,
        legalDisclaimerVersion: null,
      },
      create: {
        d7Number: 'D7TENNOCN',
        email: 'd7tennocn@benz-tech.local',
        name: 'Tenant No Consent',
        passwordHash,
        role: 'technician',
        isActive: true,
        isAdmin: false,
        mustChangePassword: false,
        dealershipId: dealershipAId,
        consentAt: null,
        consentVersion: null,
      },
    });

    // H13: JWT claims require isAdmin + full compliance shape â€” use shared helper.
    techAToken = await createCompliantSessionToken(prisma, techA, dealershipA.name);
    techBToken = await createCompliantSessionToken(prisma, techB, dealershipB.name);
    managerBToken = await createCompliantSessionToken(prisma, managerB, dealershipB.name);

    // No-consent fixture: mint a JWT with null consent (helper would stamp consent on).
    const techNoConsentFresh = await prisma.technician.findUniqueOrThrow({
      where: { id: techNoConsent.id },
    });
    techNoConsentToken = await createSessionToken({
      technicianId: techNoConsentFresh.id,
      d7Number: techNoConsentFresh.d7Number,
      name: techNoConsentFresh.name,
      role: techNoConsentFresh.role,
      isAdmin: techNoConsentFresh.isAdmin,
      dealershipId: dealershipAId,
      dealershipName: dealershipA.name,
      consentAt: null,
      consentVersion: null,
      legalDisclaimerAt: null,
      legalDisclaimerVersion: null,
      sessionVersion: techNoConsentFresh.sessionVersion,
      mustChangePassword: false,
    });

    const roInput = {
      roNumber: `TENANT-${Date.now().toString().slice(-5)}`,
      vehicle: {
        vin: 'WDDWF4KB0FR123456',
        year: '2019',
        make: 'Mercedes-Benz',
        model: 'C300',
        engine: '',
        mileageIn: '10000',
        mileageOut: '',
      },
      customer: { name: 'Tenant Test Customer' },
      complaints: ['Test complaint'],
      repairLines: [
        {
          id: 'tenant-line-1',
          lineNumber: 1,
          description: 'Tenant isolation test line',
          customerConcern: 'Test concern',
          technicianNotes: 'Test notes',
          xentryImages: [],
        },
      ],
    };

    const created = await prisma.repairOrder.create({
      data: {
        ...repairOrderToDbFields(roInput),
        technicianId: techAId,
        dealershipId: dealershipAId,
        repairLines: {
          create: roInput.repairLines.map((line) => repairLineToDbFields(line)),
        },
      },
      include: { repairLines: true },
    });
    roAId = created.id;
    lineAId = created.repairLines[0]!.id;

    await prisma.auditLog.create({
      data: {
        action: 'image.upload',
        dealershipId: dealershipAId,
        technicianId: techAId,
        metadata: JSON.stringify({ pathname: privatePathname, filename: 'private.jpg', size: 1024 }),
        previousHash: 'GENESIS',
        entryHash: `tenant-test-upload-${Date.now()}`,
      },
    });
  });

  after(async () => {
    if (roAId) {
      await prisma.repairOrder.delete({ where: { id: roAId } }).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { dealershipId: { in: [dealershipAId, dealershipBId] } },
          { technicianId: { in: [techAId, techBId] } },
        ],
      },
    });
    await prisma.technician.deleteMany({
      where: {
        d7Number: {
          in: ['D7TENANTA', 'D7TENANTB', 'D7TENMGRB', 'D7TENNOCN'],
        },
      },
    });
    await prisma.dealership.deleteMany({
      where: { id: { in: ['tenant-test-a', 'tenant-test-b'] } },
    });
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('technician B cannot read dealership A repair order by id', async () => {
    const request = buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techBToken);
    const response = await getRepairOrder(request, { params: Promise.resolve({ id: roAId }) });
    const { status } = await readJsonResponse<{ error?: string }>(response);

    assert.equal(status, 404, 'Cross-tenant RO access must return 404 (not found)');
  });

  test('technician A can read own dealership repair order by id', async () => {
    const request = buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techAToken);
    const response = await getRepairOrder(request, { params: Promise.resolve({ id: roAId }) });
    const { status, body } = await readJsonResponse<{ repairOrder: { id: string } }>(response);

    assert.equal(status, 200);
    assert.equal(body.repairOrder.id, roAId);
  });

  test('repair order list is scoped to the signed-in dealership', async () => {
    const requestA = buildAuthenticatedRequest('http://localhost/api/repair-orders', techAToken);
    const responseA = await listRepairOrders(requestA);
    const { body: bodyA } = await readJsonResponse<{ repairOrders: Array<{ id: string; dealershipId?: string }> }>(
      responseA
    );

    const requestB = buildAuthenticatedRequest('http://localhost/api/repair-orders', techBToken);
    const responseB = await listRepairOrders(requestB);
    const { body: bodyB } = await readJsonResponse<{ repairOrders: Array<{ id: string }> }>(responseB);

    assert.ok(bodyA.repairOrders.some((ro) => ro.id === roAId), 'Tech A should see own dealership RO');
    assert.ok(
      !bodyB.repairOrders.some((ro) => ro.id === roAId),
      'Tech B must not see dealership A RO in list'
    );
  });

  test('manager B cannot generate story for dealership A repair order', async () => {
    const request = buildAuthenticatedRequest(
      `http://localhost/api/repair-orders/${roAId}/lines/${lineAId}/generate-story`,
      managerBToken,
      { method: 'POST' }
    );
    const response = await postGenerateStory(request, {
      params: Promise.resolve({ id: roAId, lineId: lineAId }),
    });
    const { status } = await readJsonResponse<{ error?: string }>(response);

    assert.equal(status, 404, 'Cross-tenant generate-story must return 404 (not found)');
  });

  test('technician B cannot extract RO from dealership A uploaded image', async () => {
    const request = buildAuthenticatedRequest('http://localhost/api/repair-orders/extract', techBToken, {
      method: 'POST',
      body: { imagePathnames: [privatePathname] },
    });
    const response = await postExtract(request);
    const { status } = await readJsonResponse<{ error?: string }>(response);

    assert.equal(status, 403, 'Cross-tenant blob extract must return 403');
  });

  test('technician without consent cannot access protected APIs', async () => {
    const request = buildAuthenticatedRequest('http://localhost/api/repair-orders', techNoConsentToken);
    const response = await listRepairOrders(request);
    const { status, body } = await readJsonResponse<{ error?: string }>(response);

    assert.equal(status, 403);
    assert.equal(body.error, CONSENT_REQUIRED_ERROR);
  });

  test('technician without consent can still accept consent', async () => {
    const request = buildAuthenticatedRequest('http://localhost/api/consent', techNoConsentToken, {
      method: 'POST',
    });
    const response = await postConsent(request);
    const { status, body } = await readJsonResponse<{ consentAt?: string }>(response);

    assert.equal(status, 200);
    assert.ok(body.consentAt);
  });
});
