import '../setup/criticalPathMocks';

import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as Crypto;
}

import { PrismaClient } from '@prisma/client';
import { GET as getAuthMe } from '../../src/app/api/auth/me/route';
import { POST as postConsent } from '../../src/app/api/consent/route';
import {
  createSessionToken,
  loginTechnician,
  SESSION_COOKIE,
  verifySessionToken,
} from '../../src/lib/auth';
import { getCanonicalSeedPassword } from '../../src/lib/seedDatabase';
import { CONSENT_VERSION, LEGAL_DISCLAIMER_VERSION } from '../../src/types';
import {
  enableMerlinusPlatformModeForTests,
  restorePlatformMode,
} from '../helpers/apexIntegration';
import {
  captureTechnicianCompliance,
  ensureTechnicianCompliance,
  restoreTechnicianCompliance,
  type TechnicianComplianceSnapshot,
} from '../helpers/integrationCompliance';
import { buildAuthenticatedRequest, readJsonResponse } from '../helpers/routeTest';
import { clearCriticalPathMocks, runWithNextRouteContext } from '../setup/criticalPathMocks';

const prisma = new PrismaClient();

describe('JWT session refresh (H4)', () => {
  let previousPlatformMode: string | undefined;
  let technicianId = '';
  let dealershipId = '';
  let techName = '';
  let sessionVersion = 1;
  let originalCompliance: TechnicianComplianceSnapshot | null = null;

  before(async () => {
    previousPlatformMode = enableMerlinusPlatformModeForTests();
    const techD7 = (process.env.TECH_SEED_D7?.trim() || 'D7TECH001').toUpperCase();
    const technician = await prisma.technician.findUnique({ where: { d7Number: techD7 } });
    assert.ok(technician, 'Seed technician required — run npm run db:seed first');
    technicianId = technician.id;
    dealershipId = technician.dealershipId;
    techName = technician.name;
    sessionVersion = technician.sessionVersion;
    originalCompliance = captureTechnicianCompliance(technician);

    await ensureTechnicianCompliance(prisma, technicianId);
    sessionVersion = (
      await prisma.technician.findUniqueOrThrow({ where: { id: technicianId } })
    ).sessionVersion;
  });

  after(async () => {
    if (originalCompliance) {
      await restoreTechnicianCompliance(prisma, technicianId, originalCompliance);
    }
    clearCriticalPathMocks();
    restorePlatformMode(previousPlatformMode);
    await prisma.$disconnect();
  });

  test('GET /api/auth/me re-issues cookie when JWT compliance claims are stale', async () => {
    const staleToken = await createSessionToken({
      technicianId,
      d7Number: process.env.TECH_SEED_D7?.trim() || 'D7TECH001',
      name: techName,
      role: 'technician',
      isAdmin: false,
      dealershipId,
      dealershipName: 'Integration Dealership',
      serviceAdvisorId: null,
      consentAt: '2020-01-01T00:00:00.000Z',
      consentVersion: 'stale-consent-version',
      legalDisclaimerAt: '2020-01-01T00:00:00.000Z',
      legalDisclaimerVersion: 'stale-disclaimer-version',
      sessionVersion,
    });

    const response = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/auth/me', staleToken),
      '/api/auth/me/route',
      (req) => getAuthMe(req)
    );

    const { status, body } = await readJsonResponse<{
      session?: {
        consentVersion?: string | null;
        legalDisclaimerVersion?: string | null;
      };
    }>(response);

    assert.equal(status, 200);
    assert.equal(body.session?.consentVersion, CONSENT_VERSION);
    assert.equal(body.session?.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);

    const refreshedCookie = response.cookies.get(SESSION_COOKIE)?.value;
    assert.ok(refreshedCookie, 'auth/me should re-issue session cookie when JWT is stale');
    assert.notEqual(refreshedCookie, staleToken);

    const refreshedPayload = await verifySessionToken(refreshedCookie!);
    assert.equal(refreshedPayload?.consentVersion, CONSENT_VERSION);
    assert.equal(refreshedPayload?.legalDisclaimerVersion, LEGAL_DISCLAIMER_VERSION);
  });

  test('POST /api/consent returns refreshed session and re-issues cookie', async () => {
    await prisma.technician.update({
      where: { id: technicianId },
      data: { consentAt: null, consentVersion: null },
    });

    const loginSession = await loginTechnician(
      process.env.TECH_SEED_D7?.trim() || 'D7TECH001',
      process.env.TECH_SEED_PASSWORD?.trim() || getCanonicalSeedPassword()
    );
    assert.ok(loginSession);

    const loginToken = await createSessionToken(loginSession);

    const response = await runWithNextRouteContext(
      buildAuthenticatedRequest('http://localhost/api/consent', loginToken, { method: 'POST' }),
      '/api/consent/route',
      (req) => postConsent(req)
    );

    const { status, body } = await readJsonResponse<{
      session?: { consentAt?: string | null; consentVersion?: string | null };
    }>(response);

    assert.equal(status, 200);
    assert.ok(body.session?.consentAt);
    assert.equal(body.session?.consentVersion, CONSENT_VERSION);

    const cookie = response.cookies.get(SESSION_COOKIE)?.value;
    assert.ok(cookie, 'consent accept should re-issue session cookie');
    const payload = await verifySessionToken(cookie!);
    assert.equal(payload?.consentVersion, CONSENT_VERSION);
    assert.ok(payload?.consentAt);
  });
});