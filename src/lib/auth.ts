import 'server-only';

import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { buildMfaSessionFlags } from '@/lib/mfa/policy';
import { normalizeD7Number } from './d7Number';
import { parseSessionPayloadClaims } from './sessionClaims';
import { isTechnicianAccountActive } from './technicianAccounts';
import { logger } from './logger';

/**
 * H-1 — Enterprise identity
 *
 * Merlin uses D7 number + password (or Apex email/username) authentication.
 * P1-3: optional TOTP MFA when MERLIN_MFA_ENFORCE=true (manager/owner/admin).
 * SSO (SAML/OIDC) remains roadmap.
 *
 * Compensating controls:
 * - bcrypt password hashing (cost 12), sessionVersion revocation, 8-hour httpOnly cookies
 * - Manager-provisioned accounts and password reset via Settings
 * - Rate-limited login endpoint
 *
 * See also: src/lib/encryption.ts (L4 key rotation) and docs/Reencryption-Runbook.md.
 */

export const SESSION_COOKIE = 'benz_tech_session';
/** M9: shorter session lifetime reduces exposure from stolen cookies. */
const SESSION_MAX_AGE = 60 * 60 * 8; // 8 hours
export const JWT_ISSUER = 'merlin';
export const JWT_AUDIENCE = 'benz-tech-session';

export interface SessionPayload {
  technicianId: string;
  /** Null for owner accounts (Phase 5). */
  d7Number: string | null;
  name: string;
  role: string;
  isAdmin: boolean;
  dealershipId: string;
  dealershipName: string;
  /** APEX NATIONAL PLATFORM — optional franchise tenant; absent in legacy JWTs. */
  dealerId?: string | null;
  serviceAdvisorId: string | null;
  consentAt: string | null;
  consentVersion: string | null;
  legalDisclaimerAt: string | null;
  legalDisclaimerVersion: string | null;
  sessionVersion: number;
  /** APEX — national | group | dealership (owners only in apex mode). */
  scopeMode?: 'national' | 'group' | 'dealership';
  isOwner?: boolean;
  /** Active rooftop when scopeMode is dealership (may differ from sentinel FK). */
  activeDealershipId?: string;
  /** Active DealerGroup when scopeMode is group (PR-G2). */
  activeDealerGroupId?: string;
  dealerGroupName?: string;
  /** Provisioned / reset accounts must change password before PII routes. */
  mustChangePassword?: boolean;
  /** P1-3 — TOTP enrolled for this account. */
  mfaEnabled?: boolean;
  mfaEnrolled?: boolean;
  /** True when MERLIN_MFA_ENFORCE requires enrollment for this role. */
  mfaRequired?: boolean;
  /**
   * Phase 7.3 (H7) — IANA timezone for the active rooftop (usage caps + "today" RO lists).
   * Absent on national/group owner home; set in dealership scope.
   */
  dealershipTimezone?: string;
  /**
   * National Owner "View As" lens (dealership scope only).
   * Real identity remains role=owner; these never rewrite Technician.role in DB.
   */
  viewAsRole?: 'technician' | 'manager' | 'service_advisor' | null;
  viewAsAdmin?: boolean;
  viewAsServiceAdvisorId?: string | null;
  /**
   * Technician preferred UI/voice language (`en` | `es`, extensible).
   * Story generation always outputs English; this describes input/UI language.
   */
  preferredLanguage?: string;
}

/** APEX NATIONAL PLATFORM — resolve dealer from technician or parent dealership. */
export function resolveDealerIdFromTechnician(tech: {
  dealerId?: string | null;
  dealership: { dealerId?: string | null };
}): string | null {
  return tech.dealerId?.trim() || tech.dealership.dealerId?.trim() || null;
}

export type TechnicianForSession = {
  id: string;
  d7Number: string | null;
  name: string;
  role: string;
  isAdmin: boolean;
  dealershipId: string;
  dealerId?: string | null;
  serviceAdvisorId: string | null;
  sessionVersion: number;
  consentAt: Date | null;
  consentVersion: string | null;
  legalDisclaimerAt: Date | null;
  legalDisclaimerVersion: string | null;
  mustChangePassword?: boolean;
  preferredLanguage?: string | null;
  mfaEnabled?: boolean | null;
  mfaEnrolledAt?: Date | null;
  dealership: { name: string; dealerId?: string | null; timezone?: string | null };
};

/** Build API session payload from an active technician row (legacy JWT or Clerk bridge). */
export function buildSessionPayloadFromTechnician(tech: TechnicianForSession): SessionPayload {
  const timezone = tech.dealership.timezone?.trim() || undefined;
  const preferredLanguage =
    typeof tech.preferredLanguage === 'string' && tech.preferredLanguage.trim()
      ? tech.preferredLanguage.trim()
      : 'en';
  const mfaFlags = buildMfaSessionFlags({
    role: tech.role,
    isAdmin: tech.isAdmin,
    mfaEnabled: tech.mfaEnabled,
    mfaEnrolledAt: tech.mfaEnrolledAt,
  });
  const mfaEnabled = mfaFlags.mfaEnabled;
  const mfaEnrolled = mfaFlags.mfaEnrolled;
  const mfaRequired = mfaFlags.mfaRequired;
  return {
    technicianId: tech.id,
    d7Number: tech.d7Number,
    name: tech.name,
    role: tech.role,
    isAdmin: tech.isAdmin,
    dealershipId: tech.dealershipId,
    dealershipName: tech.dealership.name,
    dealerId: resolveDealerIdFromTechnician(tech),
    serviceAdvisorId: tech.serviceAdvisorId ?? null,
    consentAt: tech.consentAt?.toISOString() ?? null,
    consentVersion: tech.consentVersion ?? null,
    legalDisclaimerAt: tech.legalDisclaimerAt?.toISOString() ?? null,
    legalDisclaimerVersion: tech.legalDisclaimerVersion ?? null,
    sessionVersion: tech.sessionVersion,
    mustChangePassword: Boolean(tech.mustChangePassword),
    mfaEnabled,
    mfaEnrolled,
    mfaRequired,
    dealershipTimezone: timezone,
    preferredLanguage,
  };
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    // Phase 7.1 H13 — validate claim shape (no blind cast)
    const claims = parseSessionPayloadClaims(payload);
    return claims as SessionPayload | null;
  } catch {
    return null;
  }
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
    ...(maxAge === 0 ? { expires: new Date(0) } : {}),
  };
}

/** Attach session cookie to a Route Handler response (required — cookies().set() alone is dropped). */
export function applySessionCookieToResponse(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_MAX_AGE));
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, '', sessionCookieOptions(0));
}

/** Build a Set-Cookie header that fully expires the session in the response. */
export function buildSessionClearCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}

export async function destroySession(technicianId?: string): Promise<void> {
  if (technicianId) {
    await revokeTechnicianSessions(technicianId);
  }
  await clearSessionCookie();
}

async function resolveSessionPayload(tokenPayload: SessionPayload): Promise<SessionPayload | null> {
  const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
  return withRlsBypass(async () => {
    const tech = await getRlsDb().technician.findUnique({
      where: { id: tokenPayload.technicianId },
      include: { dealership: true },
    });

    if (!tech || !isTechnicianAccountActive(tech)) return null;
    if (tech.sessionVersion !== tokenPayload.sessionVersion) return null;
    if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) return null;

    return buildSessionPayloadFromTechnician(tech);
  });
}

function readSessionTokenFromRequest(request?: Request): string | undefined {
  if (!request) return undefined;
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match?.[1];
}

async function readSessionToken(request?: Request): Promise<string | undefined> {
  let token: string | undefined;

  try {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE)?.value;
  } catch {
    token = readSessionTokenFromRequest(request);
  }

  if (!token) {
    token = readSessionTokenFromRequest(request);
  }

  return token;
}

export async function getSessionContext(request?: Request): Promise<{
  session: SessionPayload | null;
  jwtPayload: SessionPayload | null;
}> {
  const token = await readSessionToken(request);
  if (!token) return { session: null, jwtPayload: null };

  const jwtPayload = await verifySessionToken(token);
  if (!jwtPayload) return { session: null, jwtPayload: null };

  const session = await resolveSessionPayload(jwtPayload);
  return { session, jwtPayload };
}

/** Legacy JWT session only. Prefer resolveAppSession() from authBridge for API routes. */
export async function getSession(request?: Request): Promise<SessionPayload | null> {
  const { session } = await getSessionContext(request);
  return session;
}

/** Legacy JWT session only. Prefer requireAppSession() from authBridge for API routes. */
export async function requireSession(request?: Request): Promise<SessionPayload> {
  const session = await getSession(request);
  if (!session) throw new Error('Unauthorized');
  return session;
}

export async function incrementSessionVersion(technicianId: string): Promise<number> {
  const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
  const updated = await withRlsBypass(async () =>
    getRlsDb().technician.update({
      where: { id: technicianId },
      data: { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    })
  );
  logger.info('auth.session_version_incremented', { technicianId, sessionVersion: updated.sessionVersion });
  return updated.sessionVersion;
}

export async function revokeTechnicianSessions(technicianId: string): Promise<void> {
  await incrementSessionVersion(technicianId);
}

export async function loginTechnician(d7Number: string, password: string): Promise<SessionPayload | null> {
  const { getRlsDb, withRlsBypass } = await import('@/lib/apex/rlsContext');
  return withRlsBypass(async () => {
    const normalizedD7 = normalizeD7Number(d7Number);
    const tech = await getRlsDb().technician.findUnique({
      where: { d7Number: normalizedD7 },
      include: { dealership: true },
    });
    if (!tech || !isTechnicianAccountActive(tech)) return null;
    if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) return null;
    const valid = await verifyPassword(password, tech.passwordHash);
    if (!valid) return null;
    return buildSessionPayloadFromTechnician(tech);
  });
}