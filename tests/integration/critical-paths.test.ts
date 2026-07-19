import '../setup/criticalPathMocks';

import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { POST as postLogin } from '../../src/app/api/auth/login/route';
import { POST as postExtract } from '../../src/app/api/repair-orders/extract/route';
import { POST as postGenerateStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route';
import { SESSION_COOKIE } from '../../src/lib/auth';
import { getCanonicalSeedPassword } from '../../src/lib/seedDatabase';
import { repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import {
  captureTechnicianCompliance,
  createCompliantSessionToken,
  restoreTechnicianCompliance,
  type TechnicianComplianceSnapshot,
} from '../helpers/integrationCompliance';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';
import { clearCriticalPathMocks, runWithNextRouteContext } from '../setup/criticalPathMocks';
import { createTestPrismaClient } from '../setup/prismaNode.mjs';

const prisma = createTestPrismaClient();

const GROK_RO_EXTRACTION = `RO Number: 482910
Customer Name: JOHN SMITH
Year: 2022
Make: Mercedes-Benz
Model: GLE 350
VIN: W1N4N4HB5NJ123456
Mileage IN: 28450
Customer Complaints:
# A RHODE ISLAND STATE INSPECTION`;

const GROK_STORY =
  'Customer Complaint: Rhode Island state inspection requested.\nCause: Inspection due per state requirements.\nCorrection: Performed RI state inspection per procedure.';

/** HTTP integration coverage for login, RO vision extract, and story generation routes. */
describe('critical path HTTP routes', () => {
  let previousPlatformMode: string | undefined;
  let technicianId = '';
  let dealershipId = '';
  let techToken = '';
  let testRoId = '';
  let testLineId = '';
  let originalCompliance: TechnicianComplianceSnapshot | null = null;
  const extractPathname = `benz-tech/critical-path-${Date.now()}.png`;
  const originalFetch = globalThis.fetch;

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    process.env.GROK_API_KEY = process.env.GROK_API_KEY || 'test-key-for-integration';

    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.x.ai')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        const parts = body?.messages?.[0]?.content;
        const hasVisionInput = Array.isArray(parts)
          ? parts.some((part: { type?: string }) => part.type === 'image_url')
          : false;
        const content = hasVisionInput ? GROK_RO_EXTRACTION : GROK_STORY;
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const techD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
    const techPassword = process.env.TECH_SEED_PASSWORD?.trim() || getCanonicalSeedPassword();

    const technician = await prisma.technician.findUnique({ where: { d7Number: techD7 } });
    assert.ok(technician, 'Seed technician required â€” run npm run db:seed first');
    technicianId = technician.id;
    dealershipId = technician.dealershipId;
    originalCompliance = captureTechnicianCompliance(technician);

    techToken = await createCompliantSessionToken(prisma, technician, 'Integration Dealership');

    const roInput = {
      roNumber: `CP-${Date.now().toString().slice(-6)}`,
      vehicle: {
        vin: 'WDDWF4KB0FR123456',
        year: '2019',
        make: 'Mercedes-Benz',
        model: 'C300',
        engine: '',
        mileageIn: '45000',
        mileageOut: '',
      },
      customer: { name: 'Critical Path Customer' },
      complaints: ['Customer states check engine light is on'],
      repairLines: [
        {
          id: 'cp-line-1',
          lineNumber: 1,
          description: 'Diagnose check engine light',
          customerConcern: 'Check engine light on',
          technicianNotes: 'Found P0300 during quick test.',
          xentryImages: [],
        },
      ],
    };

    const ro = await prisma.repairOrder.create({
      data: {
        ...repairOrderToDbFields(roInput),
        technicianId,
        dealershipId,
        repairLines: {
          create: roInput.repairLines.map((line) => repairLineToDbFields(line)),
        },
      },
      include: { repairLines: true },
    });
    testRoId = ro.id;
    testLineId = ro.repairLines[0]!.id;

    await prisma.auditLog.create({
      data: {
        action: 'image.upload',
        dealershipId,
        technicianId,
        entityType: 'image',
        entityId: extractPathname,
        metadata: JSON.stringify({ pathname: extractPathname, size: 1024 }),
        ipAddress: '127.0.0.1',
        promptVersion: '',
        previousHash: '',
        entryHash: '',
      },
    });
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    clearCriticalPathMocks();
    if (testRoId) {
      await prisma.repairOrder.delete({ where: { id: testRoId } }).catch(() => undefined);
    }
    if (originalCompliance) {
      await restoreTechnicianCompliance(prisma, technicianId, originalCompliance);
    }
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('POST /api/auth/login succeeds for seeded service manager', async () => {
    const managerD7 = (process.env.ADMIN_SEED_D7?.trim() || 'D7HARRIH').toUpperCase();
    const managerPassword =
      process.env.ADMIN_SEED_PASSWORD?.trim() || getCanonicalSeedPassword();

    const manager = await prisma.technician.findUnique({ where: { d7Number: managerD7 } });
    assert.ok(manager, 'Seed service manager required â€” run npm run db:seed first');
    assert.equal(manager.role, 'manager');

    const response = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d7Number: managerD7, password: managerPassword }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );

    const { status, body } = await readJsonResponse<{
      session?: { technicianId: string; d7Number: string; role: string; consentAt?: string | null };
      error?: string;
    }>(response);

    assert.equal(status, 200, `manager login failed: ${JSON.stringify(body)}`);
    assert.equal(body.session?.technicianId, manager.id);
    assert.equal(body.session?.d7Number, managerD7);
    assert.equal(body.session?.role, 'manager');
    const sessionCookie = response.cookies.get(SESSION_COOKIE);
    assert.ok(sessionCookie?.value, 'manager login should set session cookie on response');
  });

  test('POST /api/auth/login succeeds with valid credentials and audit trail', async () => {
    const techD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
    const techPassword = process.env.TECH_SEED_PASSWORD?.trim() || getCanonicalSeedPassword();
    assert.ok(techPassword);

    const auditBefore = await prisma.auditLog.count({
      where: { action: 'auth.login', technicianId, dealershipId },
    });

    const response = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d7Number: techD7, password: techPassword }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );

    const { status, body } = await readJsonResponse<{
      session?: { technicianId: string; d7Number: string };
      error?: string;
    }>(response);

    assert.equal(status, 200);
    assert.equal(body.session?.technicianId, technicianId);
    assert.equal(body.session?.d7Number, techD7);
    const sessionCookie = response.cookies.get(SESSION_COOKIE);
    assert.ok(sessionCookie?.value, 'login should set session cookie on response');

    const auditAfter = await prisma.auditLog.count({
      where: { action: 'auth.login', technicianId, dealershipId },
    });
    assert.ok(auditAfter > auditBefore, 'auth.login audit entry should be recorded');
  });

  test('POST /api/auth/login rejects invalid credentials', async () => {
    const response = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d7Number: 'D7TECH001', password: 'wrong-password-value' }),
      })
    );
    const { status } = await readJsonResponse(response);
    assert.equal(status, 401);
  });

  test('POST /api/repair-orders/extract returns structured RO data for owned image', async () => {
    const request = buildAuthenticatedRequest('http://localhost/api/repair-orders/extract', techToken, {
      method: 'POST',
      body: { imagePathnames: [extractPathname] },
    });

    const response = await runWithNextRouteContext(
      request,
      '/api/repair-orders/extract/route',
      (req) => postExtract(req)
    );
    const { status, body } = await readJsonResponse<{
      roNumber?: string;
      customerName?: string;
      complaints?: string[];
      error?: string;
    }>(response);

    assert.equal(status, 200);
    assert.equal(body.roNumber, '482910');
    assert.equal(body.customerName, 'JOHN SMITH');
    assert.ok(Array.isArray(body.complaints));
    assert.ok(body.complaints!.length > 0);
  });

  test('POST generate-story persists story and hash-chained audit log', async () => {
    const url = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/generate-story`;
    const request = buildAuthenticatedRequest(url, techToken, { method: 'POST' });

    const auditBefore = await prisma.auditLog.count({
      where: {
        action: 'story.generate',
        entityId: testLineId,
        dealershipId,
      },
    });

    const response = await runWithNextRouteContext(
      request,
      '/api/repair-orders/[id]/lines/[lineId]/generate-story/route',
      (req) =>
        postGenerateStory(req, {
          params: Promise.resolve({ id: testRoId, lineId: testLineId }),
        })
    );
    const { status, body } = await readJsonResponse<{
      warrantyStory?: string;
      error?: string;
    }>(response);

    assert.equal(status, 200);
    assert.ok(body.warrantyStory && body.warrantyStory.length > 20);

    const savedLine = await prisma.repairLine.findUnique({ where: { id: testLineId } });
    assert.ok(savedLine?.warrantyStoryEncrypted);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: 'story.generate',
        entityId: testLineId,
        dealershipId,
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.ok(audit, 'story.generate audit log should exist');
    assert.ok(audit?.entryHash, 'audit entry should include hash-chain entryHash');
    assert.ok(
      (await prisma.auditLog.count({
        where: { action: 'story.generate', entityId: testLineId, dealershipId },
      })) > auditBefore
    );
  });
});
