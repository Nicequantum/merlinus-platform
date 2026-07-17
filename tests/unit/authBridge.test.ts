import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test, it } from 'node:test';
import { buildSessionPayloadFromTechnician } from '../../src/lib/auth';

const root = resolve(process.cwd());

function readSrc(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('auth bridge session payload (Phase 4 PR-1)', () => {
  test('buildSessionPayloadFromTechnician maps technician row to SessionPayload', () => {
    const payload = buildSessionPayloadFromTechnician({
      id: 'tech-1',
      d7Number: 'D7HARRIH',
      name: 'Harris',
      role: 'technician',
      isAdmin: false,
      dealershipId: 'dealer-1',
      dealerId: 'apex-franchise',
      serviceAdvisorId: null,
      sessionVersion: 2,
      consentAt: new Date('2026-01-01T00:00:00.000Z'),
      consentVersion: 'v1',
      legalDisclaimerAt: null,
      legalDisclaimerVersion: null,
      dealership: { name: 'Merlinus Tiverton', dealerId: null },
    });

    assert.equal(payload.technicianId, 'tech-1');
    assert.equal(payload.d7Number, 'D7HARRIH');
    assert.equal(payload.dealershipId, 'dealer-1');
    assert.equal(payload.dealerId, 'apex-franchise');
    assert.equal(payload.sessionVersion, 2);
    assert.equal(payload.consentAt, '2026-01-01T00:00:00.000Z');
    assert.equal(payload.dealershipName, 'Merlinus Tiverton');
  });

  test('buildSessionPayloadFromTechnician inherits dealership dealerId when technician has none', () => {
    const payload = buildSessionPayloadFromTechnician({
      id: 'tech-2',
      d7Number: 'D7ADMIN',
      name: 'Admin',
      role: 'manager',
      isAdmin: true,
      dealershipId: 'dealer-1',
      dealerId: null,
      serviceAdvisorId: null,
      sessionVersion: 0,
      consentAt: null,
      consentVersion: null,
      legalDisclaimerAt: null,
      legalDisclaimerVersion: null,
      dealership: { name: 'Merlinus', dealerId: 'dealer-franchise' },
    });

    assert.equal(payload.dealerId, 'dealer-franchise');
  });
});

describe('auth bridge integration (Phase 4 PR-4)', () => {
  it('authBridge resolves Clerk sessions before legacy JWT', () => {
    const bridge = readSrc('src/lib/authBridge.ts');
    assert.ok(bridge.includes('loadLinkedTechnicianSession'));
    assert.ok(bridge.includes('attemptClerkEmailLinkOnSignIn'));
    assert.ok(bridge.includes('resolveLegacySessionContext'));
    assert.ok(bridge.includes('requireAppSession'));
  });

  it('api routes use auth bridge via withAuth', () => {
    const apiRoute = readSrc('src/lib/apiRoute.ts');
    assert.ok(apiRoute.includes("from './authBridge'"));
    assert.ok(apiRoute.includes('resolveAppSession'));
  });

  it('logout and password routes integrate Clerk session revocation', () => {
    const logout = readSrc('src/app/api/auth/logout/route.ts');
    const changePassword = readSrc('src/app/api/auth/change-password/route.ts');
    const clerkSession = readSrc('src/lib/clerkSession.ts');
    const sessionRevocation = readSrc('src/lib/sessionRevocation.ts');

    assert.ok(logout.includes('revokeActiveClerkSession') || logout.includes('revokeAllSessionsForTechnician'));
    assert.ok(changePassword.includes('revokeAllSessionsForTechnician'));
    assert.ok(sessionRevocation.includes('revokeTechnicianAuthSessions'));
    assert.ok(clerkSession.includes('revokeAllClerkSessionsForUser'));
  });
});