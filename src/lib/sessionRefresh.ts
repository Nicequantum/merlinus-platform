import 'server-only';

import { NextResponse } from 'next/server';
import {
  applyApexAccessCookie,
  createApexAccessToken,
  type ApexAccessClaims,
} from '@/lib/apex/apexSession';
import { isApexPlatformMode } from '@/lib/platformMode';
import {
  applySessionCookieToResponse,
  createSessionToken,
  type SessionPayload,
} from './auth';
import type { TechnicianSession } from '@/types';

export type ComplianceSessionFields = Pick<
  SessionPayload,
  'consentAt' | 'consentVersion' | 'legalDisclaimerAt' | 'legalDisclaimerVersion'
>;

/** True when JWT compliance claims differ from the authoritative DB session. */
export function complianceFieldsDiffer(
  jwt: ComplianceSessionFields,
  db: ComplianceSessionFields
): boolean {
  return (
    (jwt.consentAt ?? null) !== (db.consentAt ?? null) ||
    (jwt.consentVersion ?? null) !== (db.consentVersion ?? null) ||
    (jwt.legalDisclaimerAt ?? null) !== (db.legalDisclaimerAt ?? null) ||
    (jwt.legalDisclaimerVersion ?? null) !== (db.legalDisclaimerVersion ?? null)
  );
}

export function toTechnicianSession(payload: SessionPayload): TechnicianSession {
  return {
    technicianId: payload.technicianId,
    d7Number: payload.d7Number,
    name: payload.name,
    role: payload.role,
    isAdmin: payload.isAdmin,
    dealershipId: payload.dealershipId,
    dealershipName: payload.dealershipName,
    serviceAdvisorId: payload.serviceAdvisorId,
    consentAt: payload.consentAt,
    consentVersion: payload.consentVersion,
    legalDisclaimerAt: payload.legalDisclaimerAt,
    legalDisclaimerVersion: payload.legalDisclaimerVersion,
    scopeMode: payload.scopeMode,
    isOwner: payload.isOwner,
    activeDealershipId: payload.activeDealershipId,
    activeDealerGroupId: payload.activeDealerGroupId,
    dealerGroupName: payload.dealerGroupName,
    mustChangePassword: payload.mustChangePassword,
    dealershipTimezone: payload.dealershipTimezone,
    viewAsRole: payload.viewAsRole,
    viewAsAdmin: payload.viewAsAdmin,
    viewAsServiceAdvisorId: payload.viewAsServiceAdvisorId,
    preferredLanguage: payload.preferredLanguage ?? 'en',
  };
}

async function applyRefreshedSessionCookie(
  response: NextResponse,
  session: SessionPayload,
  jwtPayload: SessionPayload | ApexAccessClaims | null
): Promise<void> {
  if (isApexPlatformMode()) {
    const accessToken = await createApexAccessToken(session, {
      authSource: jwtPayload && 'authSource' in jwtPayload ? jwtPayload.authSource : 'legacy',
      scopeMode:
        jwtPayload && 'scopeMode' in jwtPayload
          ? jwtPayload.scopeMode
          : session.scopeMode ??
            (session.role === 'owner' ? 'national' : 'dealership'),
      ipHash: jwtPayload && 'ipHash' in jwtPayload ? jwtPayload.ipHash ?? null : null,
    });
    applyApexAccessCookie(response, accessToken);
    return;
  }

  const token = await createSessionToken(session);
  applySessionCookieToResponse(response, token);
}

/** Re-issue the session cookie when JWT compliance claims lag the authoritative DB session. */
export async function attachRefreshedSessionCookie(
  response: NextResponse,
  session: SessionPayload,
  jwtPayload: SessionPayload | ApexAccessClaims | null
): Promise<NextResponse> {
  if (!jwtPayload || complianceFieldsDiffer(jwtPayload, session)) {
    await applyRefreshedSessionCookie(response, session, jwtPayload);
  }
  return response;
}

export async function jsonWithSessionCookie(
  body: Record<string, unknown>,
  session: SessionPayload,
  jwtPayload: SessionPayload | ApexAccessClaims | null = null
): Promise<NextResponse> {
  const response = NextResponse.json(body);
  return attachRefreshedSessionCookie(response, session, jwtPayload);
}

/** Always re-issue cookie — use after consent/disclaimer writes that change JWT claims. */
export async function jsonWithFreshSessionCookie(
  body: Record<string, unknown>,
  session: SessionPayload
): Promise<NextResponse> {
  const response = NextResponse.json(body);
  await applyRefreshedSessionCookie(response, session, null);
  return response;
}