import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { GET as getHealth } from '../../src/app/api/health/route';
import { GET as getSecurityStatus } from '../../src/app/api/auth/security-status/route';
import { GET as getLogout } from '../../src/app/api/auth/logout/route';
import { POST as postApplyCustomerPay } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/apply-customer-pay-template/route';
import { POST as postClearCustomerPay } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/clear-customer-pay/route';
import { repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { createCompliantSessionToken } from '../helpers/integrationCompliance';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';

const prisma = new PrismaClient();

/** M27: integration coverage for health, security-status, logout, and Customer Pay apply. */
describe('medium-priority route flows', () => {
  let previousPlatformMode: string | undefined;
  let managerId = '';
  let dealershipId = '';
  let managerToken = '';
  let customerPayTemplateId = '';
  let testRoId = '';
  let testLineId = '';

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    // Prefer the pilot seed rooftop — never pick the national sentinel (__apex_national__).
    const managerD7 = (process.env.ADMIN_SEED_D7?.trim() || 'D7HARRIH').toUpperCase();
    const manager = await prisma.technician.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        role: 'manager',
        OR: [{ d7Number: managerD7 }, { dealershipId: 'seed-dealership' }],
      },
      include: { dealership: true },
    });
    assert.ok(manager, 'Seed manager required — run npm run db:seed first');
    managerId = manager.id;
    dealershipId = manager.dealershipId;
    managerToken = await createCompliantSessionToken(
      prisma,
      manager,
      manager.dealership?.name ?? 'Seed Dealership'
    );

    const cpTemplate = await prisma.template.findFirst({
      where: { isCustomerPay: true },
      select: { id: true },
    });
    assert.ok(cpTemplate, 'Seed Customer Pay template required');
    customerPayTemplateId = cpTemplate.id;

    const roInput = {
      roNumber: `M27-${Date.now().toString().slice(-6)}`,
      vehicle: {
        vin: 'WDDWF4KB0FR123456',
        year: '2015',
        make: 'Mercedes-Benz',
        model: 'C-Class',
        engine: '',
        mileageIn: '45000',
        mileageOut: '',
      },
      customer: { name: 'M27 Integration Customer' },
      complaints: ['Customer states check engine light is on'],
      repairLines: [
        {
          id: 'm27-line-1',
          lineNumber: 1,
          description: 'Customer states check engine light is on',
          customerConcern: 'Check engine light on',
          technicianNotes: '',
          xentryImages: [],
        },
      ],
    };

    const ro = await prisma.repairOrder.create({
      data: {
        ...repairOrderToDbFields(roInput),
        technicianId: managerId,
        dealershipId,
        repairLines: {
          create: roInput.repairLines.map((line) => repairLineToDbFields(line)),
        },
      },
      include: { repairLines: true },
    });
    testRoId = ro.id;
    testLineId = ro.repairLines[0]!.id;
  });

  after(async () => {
    if (testRoId) {
      await prisma.repairOrder.delete({ where: { id: testRoId } }).catch(() => undefined);
    }
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('M20: /api/health requires manager auth and reports voice config', async () => {
    const unauth = await getHealth(new Request('http://localhost/api/health'));
    const unauthBody = await readJsonResponse(unauth);
    assert.equal(unauthBody.status, 401);

    const request = buildAuthenticatedRequest('http://localhost/api/health', managerToken);
    const response = await getHealth(request);
    const { status, body } = await readJsonResponse<{
      status?: string;
      services?: Record<string, { status: string; latencyMs?: number }>;
    }>(response);
    assert.equal(status, 200, `expected HTTP 200, got ${status}: ${JSON.stringify(body)}`);
    assert.ok(
      body.status === 'ok' || body.status === 'degraded',
      `expected aggregate ok/degraded, got ${body.status}`
    );
    assert.equal(body.services?.voice?.status, 'ok');
    assert.equal(body.services?.database?.status, 'ok');
    assert.equal(body.services?.encryption?.status, 'ok');
    assert.ok(body.services?.kv);
    assert.ok(body.services?.grok);
    assert.ok(body.services?.grokConfig);
    if (body.services?.grok?.status === 'warn') {
      assert.equal(body.status, 'degraded');
    }
  });

  test('M4 security-status requires manager session', async () => {
    const request = buildAuthenticatedRequest('http://localhost/api/auth/security-status', managerToken);
    const response = await getSecurityStatus(request);
    const { status } = await readJsonResponse(response);
    assert.equal(status, 200);
  });

  test('M10: GET logout returns 405', async () => {
    const response = await getLogout(new Request('http://localhost/api/auth/logout'));
    const { status } = await readJsonResponse(response);
    assert.equal(status, 405);
  });

  test('M2/M3: Customer Pay apply is transactional and idempotent', async () => {
    const applyUrl = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/apply-customer-pay-template`;
    const buildApplyRequest = () =>
      buildAuthenticatedRequest(applyUrl, managerToken, {
        method: 'POST',
        body: { templateId: customerPayTemplateId },
      });

    const first = await postApplyCustomerPay(buildApplyRequest(), {
      params: Promise.resolve({ id: testRoId, lineId: testLineId }),
    });
    const firstBody = await readJsonResponse<{
      isCustomerPay: boolean;
      warrantyStory: string;
      idempotent?: boolean;
    }>(first);
    assert.equal(firstBody.status, 200);
    assert.equal(firstBody.body.isCustomerPay, true);
    assert.ok(firstBody.body.warrantyStory.length > 0);
    assert.equal(firstBody.body.idempotent, undefined);

    const auditCount = await prisma.auditLog.count({
      where: {
        action: 'customerPayTemplateApplied',
        entityId: testLineId,
        dealershipId,
      },
    });
    assert.equal(auditCount, 1);

    const second = await postApplyCustomerPay(buildApplyRequest(), {
      params: Promise.resolve({ id: testRoId, lineId: testLineId }),
    });
    const secondBody = await readJsonResponse<{ idempotent?: boolean }>(second);
    assert.equal(secondBody.status, 200);
    assert.equal(secondBody.body.idempotent, true);

    const auditCountAfter = await prisma.auditLog.count({
      where: {
        action: 'customerPayTemplateApplied',
        entityId: testLineId,
        dealershipId,
      },
    });
    assert.equal(auditCountAfter, 1);
  });

  test('M1: clear Customer Pay mode restores warranty AI eligibility', async () => {
    const clearUrl = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/clear-customer-pay`;
    const clearRequest = buildAuthenticatedRequest(clearUrl, managerToken, { method: 'POST' });
    const clearResponse = await postClearCustomerPay(clearRequest, {
      params: Promise.resolve({ id: testRoId, lineId: testLineId }),
    });
    assert.equal(clearResponse.status, 200);

    const line = await prisma.repairLine.findUnique({
      where: { id: testLineId },
      select: { isCustomerPay: true },
    });
    assert.equal(line?.isCustomerPay, false);
  });
});