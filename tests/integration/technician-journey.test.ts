import '../setup/criticalPathMocks';

import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, mock, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { PrismaClient } from '@prisma/client';
import { POST as postLogin } from '../../src/app/api/auth/login/route';
import { POST as postConsent } from '../../src/app/api/consent/route';
import { POST as postLegalDisclaimer } from '../../src/app/api/legal-disclaimer/route';
import { POST as postExtract } from '../../src/app/api/repair-orders/extract/route';
import { POST as postCreateRo } from '../../src/app/api/repair-orders/route';
import { POST as postGenerateStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/generate-story/route';
import { POST as postScoreStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/score-story/route';
import { POST as postCertifyStory } from '../../src/app/api/repair-orders/[id]/lines/[lineId]/certify-story/route';
import { SESSION_COOKIE } from '../../src/lib/auth';
import { getCanonicalSeedPassword } from '../../src/lib/seedDatabase';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '../../src/types';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import {
  JOURNEY_INTEGRATION_D7,
  provisionJourneyTechnician,
} from '../helpers/integrationCompliance';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';
import { clearCriticalPathMocks, runWithNextRouteContext } from '../setup/criticalPathMocks';

const prisma = new PrismaClient();

const GROK_RO_EXTRACTION = `RO Number: 771234
Customer Name: JANE TECH JOURNEY
Year: 2021
Make: Mercedes-Benz
Model: E350
VIN: WDDZF8EB5MA123456
Mileage IN: 32100
Customer Complaints:
# A CHECK ENGINE LIGHT IS ON`;

const GROK_STORY =
  'Customer Complaint: Check engine light is on.\nCause: P0300 random misfire documented during quick test.\nCorrection: Replaced ignition coil on cylinder 1 per guided test findings.';

const GROK_SCORE_JSON = JSON.stringify({
  score: 88,
  grade: 'B+',
  strengths: ['Clear three-part structure', 'Documents diagnostic steps'],
  improvements: ['Add test drive confirmation'],
  auditRisks: [],
  technicianDetails: [],
  summary: 'Story meets warranty documentation standards.',
});

function pickSessionToken(response: Response, fallback: string): string {
  const cookie = response.cookies.get(SESSION_COOKIE)?.value;
  return cookie ?? fallback;
}

/** End-to-end technician workflow: login → compliance → scan → story → audit → certify. */
describe('technician journey (E2E integration)', () => {
  let previousPlatformMode: string | undefined;
  let technicianId = '';
  let dealershipId = '';
  let techName = '';
  let techD7 = '';
  let testRoId = '';
  let testLineId = '';
  const extractPathname = `benz-tech/journey-${Date.now()}.png`;
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
        const wantsJson =
          body?.response_format?.type === 'json_object' ||
          body?.response_format?.type === 'json_schema';

        let content = GROK_STORY;
        if (hasVisionInput) content = GROK_RO_EXTRACTION;
        else if (wantsJson) content = GROK_SCORE_JSON;

        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const seedD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
    const seedTechnician = await prisma.technician.findUnique({ where: { d7Number: seedD7 } });
    assert.ok(seedTechnician, 'Seed technician required — run npm run db:seed first');

    const journeyTechnician = await provisionJourneyTechnician(prisma, {
      dealershipId: seedTechnician.dealershipId,
      passwordHash: seedTechnician.passwordHash,
      name: 'Journey Integration Technician',
    });

    techD7 = JOURNEY_INTEGRATION_D7;
    technicianId = journeyTechnician.id;
    dealershipId = journeyTechnician.dealershipId;
    techName = journeyTechnician.name;
    assert.equal(journeyTechnician.legalDisclaimerAt, null);
    assert.equal(journeyTechnician.consentAt, null);

    await prisma.auditLog.create({
      data: {
        action: 'image.upload',
        dealershipId,
        technicianId,
        entityType: 'image',
        entityId: extractPathname,
        metadata: JSON.stringify({ pathname: extractPathname, size: 2048 }),
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
    await prisma.technician
      .delete({ where: { d7Number: JOURNEY_INTEGRATION_D7 } })
      .catch(() => undefined);
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('full journey from login through story certification', async () => {
    const journeyStartedAt = new Date();
    const techPassword = process.env.TECH_SEED_PASSWORD?.trim() || getCanonicalSeedPassword();

    const loginResponse = await runWithNextRouteContext(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ d7Number: techD7, password: techPassword }),
      }),
      '/api/auth/login/route',
      (req) => postLogin(req)
    );

    const loginJson = await readJsonResponse<{
      session?: {
        technicianId: string;
        consentAt?: string | null;
        legalDisclaimerAt?: string | null;
      };
    }>(loginResponse);
    assert.equal(loginJson.status, 200, `login failed: ${JSON.stringify(loginJson.body)}`);
    assert.equal(loginJson.body.session?.technicianId, technicianId);
    assert.equal(loginJson.body.session?.consentAt ?? null, null);
    assert.equal(loginJson.body.session?.legalDisclaimerAt ?? null, null);

    let sessionToken = pickSessionToken(loginResponse, '');
    assert.ok(sessionToken, 'login should set session cookie');

    const consentResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/consent', sessionToken, { method: 'POST' }),
      '/api/consent/route',
      (req) => postConsent(req)
    );
    const consentJson = await readJsonResponse<{
      session?: {
        consentAt?: string;
        consentVersion?: string;
        legalDisclaimerAt?: string | null;
      };
    }>(consentResponse);
    assert.equal(consentJson.status, 200);
    assert.equal(consentJson.body.session?.consentVersion, CONSENT_VERSION);
    assert.equal(consentJson.body.session?.legalDisclaimerAt ?? null, null);
    sessionToken = pickSessionToken(consentResponse, sessionToken);

    const disclaimerResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/legal-disclaimer', sessionToken, {
        method: 'POST',
      }),
      '/api/legal-disclaimer/route',
      (req) => postLegalDisclaimer(req)
    );
    const disclaimerJson = await readJsonResponse<{
      session?: { legalDisclaimerAt?: string; legalDisclaimerVersion?: string };
    }>(disclaimerResponse);
    assert.equal(disclaimerJson.status, 200);
    assert.equal(disclaimerJson.body.session?.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);
    sessionToken = pickSessionToken(disclaimerResponse, sessionToken);

    const extractResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/repair-orders/extract', sessionToken, {
        method: 'POST',
        body: { imagePathnames: [extractPathname] },
      }),
      '/api/repair-orders/extract/route',
      (req) => postExtract(req)
    );
    const extractJson = await readJsonResponse<{
      roNumber?: string;
      customerName?: string;
      complaints?: string[];
    }>(extractResponse);
    assert.equal(extractJson.status, 200);
    assert.equal(extractJson.body.roNumber, '771234');
    assert.equal(extractJson.body.customerName, 'JANE TECH JOURNEY');
    assert.ok(extractJson.body.complaints && extractJson.body.complaints.length > 0);

    const createRoResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/repair-orders', sessionToken, {
        method: 'POST',
        body: {
          fromExtraction: true,
          roNumber: extractJson.body.roNumber,
          customerName: extractJson.body.customerName,
          complaints: extractJson.body.complaints,
          vehicle: {
            vin: 'WDDZF8EB5MA123456',
            year: '2021',
            make: 'Mercedes-Benz',
            model: 'E350',
            mileageIn: '32100',
          },
        },
      }),
      '/api/repair-orders/route',
      (req) => postCreateRo(req)
    );
    const createRoJson = await readJsonResponse<{
      repairOrder?: { id: string; repairLines: Array<{ id: string }> };
    }>(createRoResponse);
    assert.equal(createRoJson.status, 200, `create RO failed: ${JSON.stringify(createRoJson.body)}`);
    testRoId = createRoJson.body.repairOrder?.id ?? '';
    testLineId = createRoJson.body.repairOrder?.repairLines[0]?.id ?? '';
    assert.ok(testRoId);
    assert.ok(testLineId);

    const generateUrl = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/generate-story`;
    const generateResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest(generateUrl, sessionToken, { method: 'POST' }),
      '/api/repair-orders/[id]/lines/[lineId]/generate-story/route',
      (req) =>
        postGenerateStory(req, {
          params: Promise.resolve({ id: testRoId, lineId: testLineId }),
        })
    );
    const generateJson = await readJsonResponse<{ warrantyStory?: string }>(generateResponse);
    assert.equal(generateJson.status, 200);
    assert.ok(generateJson.body.warrantyStory && generateJson.body.warrantyStory.length > 20);
    const warrantyStory = generateJson.body.warrantyStory!;

    const scoreUrl = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/score-story`;
    const scoreResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest(scoreUrl, sessionToken, {
        method: 'POST',
        body: { warrantyStory },
      }),
      '/api/repair-orders/[id]/lines/[lineId]/score-story/route',
      (req) =>
        postScoreStory(req, {
          params: Promise.resolve({ id: testRoId, lineId: testLineId }),
        })
    );
    const scoreJson = await readJsonResponse<{
      quality?: { score: number; grade: string; parseFailed?: boolean };
    }>(scoreResponse);
    assert.equal(scoreJson.status, 200, `score failed: ${JSON.stringify(scoreJson.body)}`);
    assert.equal(scoreJson.body.quality?.parseFailed, false);
    assert.ok(typeof scoreJson.body.quality?.score === 'number');

    const certifyUrl = `http://localhost/api/repair-orders/${testRoId}/lines/${testLineId}/certify-story`;
    const certifyResponse = await runWithNextRouteContext(
      buildAuthenticatedRequest(certifyUrl, sessionToken, {
        method: 'POST',
        body: { warrantyStory, certifiedByName: techName },
      }),
      '/api/repair-orders/[id]/lines/[lineId]/certify-story/route',
      (req) =>
        postCertifyStory(req, {
          params: Promise.resolve({ id: testRoId, lineId: testLineId }),
        })
    );
    const certifyJson = await readJsonResponse<{
      certifiedAt?: string;
      certifiedByName?: string;
      storyHash?: string;
    }>(certifyResponse);
    assert.equal(certifyJson.status, 200, `certify failed: ${JSON.stringify(certifyJson.body)}`);
    assert.ok(certifyJson.body.certifiedAt);
    assert.equal(certifyJson.body.certifiedByName, techName);
    assert.ok(certifyJson.body.storyHash);

    const auditActions = await prisma.auditLog.findMany({
      where: {
        dealershipId,
        technicianId,
        createdAt: { gte: journeyStartedAt },
        action: {
          in: [
            'auth.login',
            'consent.accept',
            'legalDisclaimer.accept',
            'ro.extract',
            'ro.create',
            'story.generate',
            'story.score',
            'story.certify',
          ],
        },
      },
      select: { action: true },
    });
    const actions = new Set(auditActions.map((row) => row.action));
    for (const expected of [
      'auth.login',
      'consent.accept',
      'legalDisclaimer.accept',
      'ro.extract',
      'ro.create',
      'story.generate',
      'story.score',
      'story.certify',
    ]) {
      assert.ok(actions.has(expected), `missing audit action: ${expected}`);
    }

    const certifiedLine = await prisma.repairLine.findUnique({ where: { id: testLineId } });
    assert.ok(certifiedLine?.storyCertifiedAt);
    assert.ok(certifiedLine?.storyCertifiedHash?.trim());
  });
});