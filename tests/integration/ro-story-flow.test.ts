import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';
import { writeAuditLog } from '../../src/lib/audit';
import { loginTechnician } from '../../src/lib/auth';
import { getCanonicalSeedPassword } from '../../src/lib/seedDatabase';
import { encryptPII } from '../../src/lib/encryption';
import { dbToRepairLine, dbToRepairOrder, repairLineToDbFields, repairOrderToDbFields } from '../../src/lib/roMapper';
import { createRepairOrderSchema, parseBody } from '../../src/lib/validation';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import { createTestPrismaClient } from '../setup/prismaNode.mjs';

const prisma = createTestPrismaClient();
const TEST_RO_NUMBER = `ITEST-${Date.now().toString().slice(-6)}`;

const GROK_STORY =
  'Customer Complaint: Check engine light on.\nCause: P0300 documented in technician notes.\nCorrection: Replaced ignition coil per findings.';

describe('RO -> story generation integration', () => {
  let previousPlatformMode: string | undefined;
  let technicianId = '';
  let dealershipId = '';
  let roId = '';
  let lineId = '';
  const originalFetch = globalThis.fetch;

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    process.env.GROK_API_KEY = process.env.GROK_API_KEY || 'test-key-for-integration';

    globalThis.fetch = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('api.x.ai')) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: GROK_STORY } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const techD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
    const techPassword = process.env.TECH_SEED_PASSWORD?.trim() || getCanonicalSeedPassword();
    const session = await loginTechnician(techD7, techPassword);
    assert.ok(session, 'Seed technician must exist — run npm run db:seed first');
    technicianId = session.technicianId;
    dealershipId = session.dealershipId;
  });

  after(async () => {
    globalThis.fetch = originalFetch;
    if (roId) {
      await prisma.repairOrder.delete({ where: { id: roId } }).catch(() => undefined);
    }
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('sanitizes XSS payloads in RO create input', () => {
    const parsed = parseBody(createRepairOrderSchema, {
      roNumber: TEST_RO_NUMBER,
      customerName: '<script>alert(1)</script>Jane Doe',
      complaints: ['<img src=x onerror=alert(1)>Engine light', 'javascript:alert(1)'],
      vehicle: { vin: 'WDDWF4KB0FR123456', year: '2019', make: 'Mercedes-Benz', model: 'C300' },
      repairLines: [
        {
          lineNumber: 1,
          description: '<b>Diagnose</b> misfire',
          customerConcern: '<script>steal()</script>Rough idle',
          technicianNotes: 'Found P0300. onclick=evil()',
        },
      ],
    });

    assert.ok(!('error' in parsed), parsed && 'error' in parsed ? parsed.error : '');
    if ('error' in parsed) return;

    assert.ok(!parsed.data.customerName?.includes('<script>'));
    assert.ok(!parsed.data.complaints?.some((c) => c.includes('<img')));
    assert.ok(!parsed.data.complaints?.some((c) => c.toLowerCase().includes('javascript:')));
    assert.ok(!parsed.data.repairLines?.[0]?.description?.includes('<b>'));
    assert.ok(!parsed.data.repairLines?.[0]?.technicianNotes?.includes('onclick'));
  });

  test('creates repair order, generates warranty story, and records audit log', async () => {
    const parsed = parseBody(createRepairOrderSchema, {
      roNumber: TEST_RO_NUMBER,
      customerName: 'Integration Test Customer',
      complaints: ['A: Check engine light on'],
      vehicle: {
        vin: 'WDDWF4KB0FR123456',
        year: '2019',
        make: 'Mercedes-Benz',
        model: 'C300',
        mileageIn: '45000',
      },
      repairLines: [
        {
          lineNumber: 1,
          description: 'Diagnose check engine light',
          customerConcern: 'Check engine light on',
          technicianNotes: 'Quick Test found P0300. Performed coil swap test — misfire followed coil.',
        },
      ],
    });

    assert.ok(!('error' in parsed));
    if ('error' in parsed) return;

    const input = {
      roNumber: parsed.data.roNumber || TEST_RO_NUMBER,
      vehicle: {
        vin: parsed.data.vehicle?.vin || '',
        year: parsed.data.vehicle?.year || '',
        make: parsed.data.vehicle?.make || '',
        model: parsed.data.vehicle?.model || '',
        engine: parsed.data.vehicle?.engine || '',
        mileageIn: parsed.data.vehicle?.mileageIn || '',
        mileageOut: parsed.data.vehicle?.mileageOut || '',
      },
      customer: { name: parsed.data.customerName || 'Integration Test Customer' },
      complaints: parsed.data.complaints || [],
      repairLines: [
        {
          id: 'itest-line-1',
          lineNumber: 1,
          description: parsed.data.repairLines?.[0]?.description || 'Diagnose check engine light',
          customerConcern: parsed.data.repairLines?.[0]?.customerConcern || '',
          technicianNotes: parsed.data.repairLines?.[0]?.technicianNotes || '',
          xentryImages: [],
          extractedData: {
            codes: ['P0300'],
            faultCodes: [{ code: 'P0300', description: 'Random misfire detected' }],
            guidedTests: [],
            measurements: [],
            components: [],
            circuits: [],
          },
        },
      ],
    };

    const created = await prisma.repairOrder.create({
      data: {
        ...repairOrderToDbFields(input),
        technicianId,
        dealershipId,
        repairLines: {
          create: input.repairLines.map((line) => repairLineToDbFields(line)),
        },
      },
      include: { repairLines: true },
    });

    roId = created.id;
    lineId = created.repairLines[0].id;

    const savedLineRow = created.repairLines[0];
    assert.notEqual(savedLineRow.technicianNotesEncrypted, input.repairLines[0].technicianNotes);
    assert.ok(savedLineRow.technicianNotesEncrypted.length > 0);
    assert.equal(dbToRepairLine(savedLineRow).technicianNotes, input.repairLines[0].technicianNotes);

    const mapped = dbToRepairOrder(created);
    const line = mapped.repairLines[0];

    const { generateWarrantyStory } = await import('../../src/lib/grok');
    const warrantyStory = await generateWarrantyStory(mapped, line);

    assert.ok(warrantyStory.length > 20, 'Expected non-trivial warranty story');
    assert.match(warrantyStory, /Customer Complaint|P0300|engine/i);

    await prisma.repairLine.update({
      where: { id: lineId },
      data: { warrantyStoryEncrypted: encryptPII(warrantyStory) },
    });

    await writeAuditLog({
      action: 'story.generate',
      dealershipId,
      technicianId,
      entityType: 'repairLine',
      entityId: lineId,
      metadata: { repairOrderId: roId, lineNumber: line.lineNumber, integrationTest: true },
    });

    const savedLine = await prisma.repairLine.findUnique({ where: { id: lineId } });
    assert.notEqual(savedLine?.warrantyStoryEncrypted, warrantyStory);
    assert.equal(dbToRepairLine(savedLine!).warrantyStory, warrantyStory);

    const audit = await prisma.auditLog.findFirst({
      where: {
        dealershipId,
        action: 'story.generate',
        entityId: lineId,
      },
      orderBy: { createdAt: 'desc' },
    });

    assert.ok(audit, 'story.generate audit log should exist');
    assert.ok(audit?.entryHash, 'audit entry should have hash-chain entryHash');
  });
});
