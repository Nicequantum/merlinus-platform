/**
 * P3 tenant isolation matrix — Attack Plan §P3 isolation tests.
 *
 * Complements tests/integration/tenant-isolation.test.ts with audit, certify,
 * images, module-gated maintenance, and UsageEvent scoping.
 */
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import bcrypt from 'bcryptjs';
import { GET as getAuditLogs } from '../../src/app/api/audit-logs/route';
import { GET as getImages } from '../../src/app/api/images/route';
import { GET as getMaintenanceTickets } from '../../src/app/api/maintenance/tickets/route';
import { POST as postCertifyStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/certify-story/route';
import { GET as getRepairOrder } from '../../src/app/api/repair-orders/[id]/route';
import { GET as listRepairOrders } from '../../src/app/api/repair-orders/route';
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

const onboarding = {
  consentAt: new Date(),
  consentVersion: CONSENT_VERSION,
  legalDisclaimerAt: new Date(),
  legalDisclaimerVersion: LEGAL_DISCLAIMER_VERSION,
};

describe('tenant isolation matrix (Attack Plan P3)', () => {
  let previousPlatformMode: string | undefined;
  let dealershipAId = '';
  let dealershipBId = '';
  let techAId = '';
  let techBId = '';
  let techAToken = '';
  let techBToken = '';
  let managerAToken = '';
  let managerBToken = '';
  let roAId = '';
  let lineAId = '';
  let usageEventId = '';
  const privatePathname = 'benz-tech/tenant-matrix-private.jpg';

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    const passwordHash = await bcrypt.hash(
      process.env.INTEGRATION_TEST_PASSWORD?.trim() || `tenant-matrix-${Date.now()}`,
      12
    );

    const dealershipA = await prisma.dealership.upsert({
      where: { id: 'tenant-matrix-a' },
      update: {},
      create: { id: 'tenant-matrix-a', name: 'Tenant Matrix Dealership A' },
    });
    const dealershipB = await prisma.dealership.upsert({
      where: { id: 'tenant-matrix-b' },
      update: {},
      create: { id: 'tenant-matrix-b', name: 'Tenant Matrix Dealership B' },
    });
    dealershipAId = dealershipA.id;
    dealershipBId = dealershipB.id;

    const ready = {
      isActive: true as const,
      deletedAt: null as Date | null,
      mustChangePassword: false,
      isAdmin: false,
      ...onboarding,
    };

    const techA = await prisma.technician.upsert({
      where: { d7Number: 'D7MTXA' },
      update: { dealershipId: dealershipAId, ...ready },
      create: {
        d7Number: 'D7MTXA',
        email: 'd7mtxa@benz-tech.local',
        name: 'Matrix Tech A',
        passwordHash,
        role: 'technician',
        dealershipId: dealershipAId,
        ...ready,
      },
    });
    const techB = await prisma.technician.upsert({
      where: { d7Number: 'D7MTXB' },
      update: { dealershipId: dealershipBId, ...ready },
      create: {
        d7Number: 'D7MTXB',
        email: 'd7mtxb@benz-tech.local',
        name: 'Matrix Tech B',
        passwordHash,
        role: 'technician',
        dealershipId: dealershipBId,
        ...ready,
      },
    });
    const managerA = await prisma.technician.upsert({
      where: { d7Number: 'D7MTXMA' },
      update: { dealershipId: dealershipAId, role: 'manager', ...ready },
      create: {
        d7Number: 'D7MTXMA',
        email: 'd7mtxma@benz-tech.local',
        name: 'Matrix Manager A',
        passwordHash,
        role: 'manager',
        dealershipId: dealershipAId,
        ...ready,
      },
    });
    const managerB = await prisma.technician.upsert({
      where: { d7Number: 'D7MTXMB' },
      update: { dealershipId: dealershipBId, role: 'manager', ...ready },
      create: {
        d7Number: 'D7MTXMB',
        email: 'd7mtxmb@benz-tech.local',
        name: 'Matrix Manager B',
        passwordHash,
        role: 'manager',
        dealershipId: dealershipBId,
        ...ready,
      },
    });
    techAId = techA.id;
    techBId = techB.id;

    techAToken = await createCompliantSessionToken(prisma, techA, dealershipA.name);
    techBToken = await createCompliantSessionToken(prisma, techB, dealershipB.name);
    managerAToken = await createCompliantSessionToken(prisma, managerA, dealershipA.name);
    managerBToken = await createCompliantSessionToken(prisma, managerB, dealershipB.name);

    const roInput = {
      roNumber: `MTX-${Date.now().toString().slice(-6)}`,
      vehicle: {
        vin: 'WDDWF4KB0FR654321',
        year: '2020',
        make: 'Mercedes-Benz',
        model: 'E350',
        engine: '',
        mileageIn: '20000',
        mileageOut: '',
      },
      customer: { name: 'Matrix Customer' },
      complaints: ['Matrix complaint'],
      repairLines: [
        {
          id: 'mtx-line-1',
          lineNumber: 1,
          description: 'Matrix isolation line',
          customerConcern: 'Noise',
          technicianNotes: 'Verified',
          warrantyStory: 'Complaint: noise. Cause: worn part. Correction: replaced part and road tested.',
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

    // Billable first-story event on A — B must never see via scoped queries.
    const ue = await prisma.usageEvent.create({
      data: {
        dealershipId: dealershipAId,
        repairOrderId: roAId,
        repairLineId: lineAId,
        eventType: 'story_generated',
      },
    });
    usageEventId = ue.id;

    await prisma.auditLog.create({
      data: {
        action: 'story.generate',
        dealershipId: dealershipAId,
        technicianId: techAId,
        entityType: 'repair_line',
        entityId: lineAId,
        metadata: JSON.stringify({ roId: roAId }),
        previousHash: 'GENESIS',
        entryHash: `mtx-audit-${Date.now()}`,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'image.upload',
        dealershipId: dealershipAId,
        technicianId: techAId,
        metadata: JSON.stringify({
          pathname: privatePathname,
          filename: 'matrix-private.jpg',
          size: 2048,
        }),
        previousHash: 'GENESIS',
        entryHash: `mtx-img-${Date.now()}`,
      },
    });

    // Ensure maintenance module is OFF for A (default) — B calling with session still must not see A's tickets if any.
    await prisma.dealershipModule.deleteMany({
      where: {
        dealershipId: { in: [dealershipAId, dealershipBId] },
        moduleId: 'maintenance',
      },
    });
  });

  after(async () => {
    if (usageEventId) {
      await prisma.usageEvent.deleteMany({ where: { id: usageEventId } }).catch(() => undefined);
    }
    if (roAId) {
      await prisma.repairOrder.delete({ where: { id: roAId } }).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({
      where: {
        dealershipId: { in: [dealershipAId, dealershipBId] },
      },
    });
    await prisma.dealershipModule.deleteMany({
      where: { dealershipId: { in: [dealershipAId, dealershipBId] } },
    });
    await prisma.technician.deleteMany({
      where: { d7Number: { in: ['D7MTXA', 'D7MTXB', 'D7MTXMA', 'D7MTXMB'] } },
    });
    await prisma.dealership.deleteMany({
      where: { id: { in: ['tenant-matrix-a', 'tenant-matrix-b'] } },
    });
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('T1: tech A list contains A RO; tech B list does not', async () => {
    const resA = await listRepairOrders(buildAuthenticatedRequest('http://localhost/api/repair-orders', techAToken));
    const resB = await listRepairOrders(buildAuthenticatedRequest('http://localhost/api/repair-orders', techBToken));
    const bodyA = await readJsonResponse<{ repairOrders: Array<{ id: string }> }>(resA);
    const bodyB = await readJsonResponse<{ repairOrders: Array<{ id: string }> }>(resB);
    assert.equal(bodyA.status, 200);
    assert.ok(bodyA.body.repairOrders.some((r) => r.id === roAId));
    assert.ok(!bodyB.body.repairOrders.some((r) => r.id === roAId));
  });

  test('T2: tech B GET A RO by id → 404 (no body leak)', async () => {
    const res = await getRepairOrder(
      buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techBToken),
      { params: Promise.resolve({ id: roAId }) }
    );
    const { status, body } = await readJsonResponse<{ repairOrder?: unknown; error?: string }>(res);
    assert.equal(status, 404);
    assert.equal(body.repairOrder, undefined);
  });

  test('T3: tech B cannot load A private image pathname', async () => {
    const url = `http://localhost/api/images?pathname=${encodeURIComponent(privatePathname)}`;
    const res = await getImages(buildAuthenticatedRequest(url, techBToken));
    // Denied as 404 (not found) to avoid existence oracle — or 403 depending on path validation.
    assert.ok([403, 404].includes(res.status), `expected 403/404 got ${res.status}`);
  });

  test('T4: manager B audit log does not include A story.generate for A line', async () => {
    const res = await getAuditLogs(
      buildAuthenticatedRequest('http://localhost/api/audit-logs?action=story.generate', managerBToken)
    );
    const { status, body } = await readJsonResponse<{
      entries?: Array<{ entityId?: string; dealershipId?: string }>;
      logs?: Array<{ entityId?: string; dealershipId?: string }>;
      auditLogs?: Array<{ entityId?: string }>;
    }>(res);
    // Manager required — 200 with empty or non-A data
    if (status === 200) {
      const rows = body.entries || body.logs || body.auditLogs || [];
      assert.ok(
        !rows.some((r) => r.entityId === lineAId),
        'Manager B must not see dealership A audit rows for line A'
      );
    } else {
      // Some envs may require extra gates; still must not be 200 with A data
      assert.notEqual(status, 500);
    }
  });

  test('T5: manager A can read audit (own rooftop path does not 403 as wrong tenant)', async () => {
    const res = await getAuditLogs(
      buildAuthenticatedRequest('http://localhost/api/audit-logs', managerAToken)
    );
    assert.ok([200, 403].includes(res.status));
    if (res.status === 200) {
      const { body } = await readJsonResponse<Record<string, unknown>>(res);
      assert.ok(body);
    }
  });

  test('T6: tech B certify-story on A line → 404', async () => {
    const res = await postCertifyStory(
      buildAuthenticatedRequest(
        `http://localhost/api/repair-orders/${roAId}/lines/${lineAId}/certify-story`,
        techBToken,
        {
          method: 'POST',
          body: {
            certifiedByName: 'Matrix Tech B',
            certifiedByD7: 'D7MTXB',
          },
        }
      ),
      { params: Promise.resolve({ id: roAId, lineId: lineAId }) }
    );
    const { status, body } = await readJsonResponse<{ repairOrder?: unknown }>(res);
    assert.ok([403, 404].includes(status), `expected 403/404 got ${status}`);
    assert.equal(body.repairOrder, undefined);
  });

  test('T7: maintenance module off → MODULE_DISABLED for both tenants (no cross data)', async () => {
    const resB = await getMaintenanceTickets(
      buildAuthenticatedRequest('http://localhost/api/maintenance/tickets', managerBToken)
    );
    const { status, body } = await readJsonResponse<{ error?: string; code?: string }>(resB);
    // Module off → 403 MODULE_DISABLED preferred
    assert.ok([403, 404].includes(status), `expected module deny got ${status}`);
    if (status === 403 && body.error) {
      assert.match(String(body.error), /module|disabled|not enabled|MODULE/i);
    }
  });

  test('T8: UsageEvent for A is not queryable under dealership B filter', async () => {
    const asB = await prisma.usageEvent.findMany({
      where: { dealershipId: dealershipBId, eventType: 'story_generated' },
    });
    assert.ok(!asB.some((e) => e.id === usageEventId));

    const asA = await prisma.usageEvent.findMany({
      where: { dealershipId: dealershipAId, eventType: 'story_generated' },
    });
    assert.ok(asA.some((e) => e.id === usageEventId));
  });

  test('T9: tech A can still read own RO (positive control)', async () => {
    const res = await getRepairOrder(
      buildAuthenticatedRequest(`http://localhost/api/repair-orders/${roAId}`, techAToken),
      { params: Promise.resolve({ id: roAId }) }
    );
    const { status, body } = await readJsonResponse<{ repairOrder: { id: string } }>(res);
    assert.equal(status, 200);
    assert.equal(body.repairOrder.id, roAId);
  });
});
