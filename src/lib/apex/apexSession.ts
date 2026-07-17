import 'server-only';

import { createHash, randomBytes, randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import type { AuditScopeMode } from '@/lib/apex/platformConstants';
import { findActiveDealershipMembership } from '@/lib/apex/membershipGuard';
import {
  buildOwnerDealershipSession,
  buildOwnerGroupSession,
  buildOwnerHomeSession,
} from '@/lib/apex/ownerDealershipContext';
import {
  buildSessionPayloadFromTechnician,
  type SessionPayload,
  type TechnicianForSession,
} from '@/lib/auth';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';
import {
  parseApexAccessClaims,
  parsePendingSelectionClaims,
} from '@/lib/sessionClaims';
import { isTechnicianAccountActive } from '@/lib/technicianAccounts';
import { logger } from '@/lib/logger';
import { getRequestIp } from '@/lib/rate-limit';

export const APEX_ACCESS_COOKIE = 'apex_access';
export const APEX_REFRESH_COOKIE = 'apex_refresh';

export const APEX_JWT_ISSUER = 'apex';
export const APEX_JWT_AUDIENCE_ACCESS = 'benz-tech-apex-access';
export const APEX_JWT_AUDIENCE_PENDING = 'benz-tech-apex-pending';

const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_PENDING_TTL_SECONDS = 5 * 60;

export type ApexAuthSource = 'legacy' | 'clerk' | 'refresh';

export interface ApexAccessClaims extends SessionPayload {
  tokenType: 'access';
  scopeMode: AuditScopeMode;
  authSource: ApexAuthSource;
  ipHash: string | null;
}

export interface PendingSelectionClaims {
  tokenType: 'pending_selection';
  technicianId: string;
  credentialType: string;
  sessionVersion: number;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function getAccessTokenTtlSeconds(): number {
  const raw = Number(process.env.ACCESS_TOKEN_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ACCESS_TTL_SECONDS;
}

export function getRefreshTokenTtlSeconds(): number {
  const raw = Number(process.env.REFRESH_TOKEN_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REFRESH_TTL_SECONDS;
}

export function getPendingSelectionTtlSeconds(): number {
  return DEFAULT_PENDING_TTL_SECONDS;
}

export function hashClientIp(ip: string): string | null {
  if (!ip || ip === 'unknown') return null;
  const salt = process.env.SESSION_IP_SALT?.trim() || process.env.SESSION_SECRET?.trim() || '';
  return sha256Hex(`${salt}:${ip}`);
}

export function hashUserAgent(userAgent: string | null | undefined): string | null {
  const trimmed = userAgent?.trim();
  if (!trimmed) return null;
  const salt = process.env.SESSION_IP_SALT?.trim() || process.env.SESSION_SECRET?.trim() || '';
  return sha256Hex(`${salt}:ua:${trimmed}`);
}

export function resolveScopeModeForRole(role: string): AuditScopeMode {
  return role === 'owner' ? 'national' : 'dealership';
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge,
    path: '/',
    ...(maxAge === 0 ? { expires: new Date(0) } : {}),
  };
}

export function applyApexAccessCookie(response: NextResponse, token: string): void {
  response.cookies.set(APEX_ACCESS_COOKIE, token, cookieOptions(getAccessTokenTtlSeconds()));
}

export function applyApexRefreshCookie(response: NextResponse, token: string): void {
  response.cookies.set(APEX_REFRESH_COOKIE, token, cookieOptions(getRefreshTokenTtlSeconds()));
}

export function clearApexSessionCookies(response: NextResponse): void {
  response.cookies.set(APEX_ACCESS_COOKIE, '', cookieOptions(0));
  response.cookies.set(APEX_REFRESH_COOKIE, '', cookieOptions(0));
}

function readCookieFromRequest(request: Request | undefined, name: string): string | undefined {
  if (!request) return undefined;
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

async function readCookie(name: string, request?: Request): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    const value = cookieStore.get(name)?.value;
    if (value) return value;
  } catch {
    // Route Handler may pass request explicitly.
  }
  return readCookieFromRequest(request, name);
}

export async function readApexAccessToken(request?: Request): Promise<string | undefined> {
  return readCookie(APEX_ACCESS_COOKIE, request);
}

export async function readApexRefreshToken(request?: Request): Promise<string | undefined> {
  return readCookie(APEX_REFRESH_COOKIE, request);
}

export async function createApexAccessToken(
  session: SessionPayload,
  options: {
    scopeMode?: AuditScopeMode;
    authSource?: ApexAuthSource;
    ipHash?: string | null;
  } = {}
): Promise<string> {
  const claims: ApexAccessClaims = {
    ...session,
    tokenType: 'access',
    scopeMode:
      options.scopeMode ?? session.scopeMode ?? resolveScopeModeForRole(session.role),
    authSource: options.authSource ?? 'legacy',
    ipHash: options.ipHash ?? null,
  };

  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(APEX_JWT_ISSUER)
    .setAudience(APEX_JWT_AUDIENCE_ACCESS)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${getAccessTokenTtlSeconds()}s`)
    .sign(getSecret());
}

export async function verifyApexAccessToken(token: string): Promise<ApexAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: APEX_JWT_ISSUER,
      audience: APEX_JWT_AUDIENCE_ACCESS,
    });
    // Phase 7.1 H13 — Zod claim validation
    const claims = parseApexAccessClaims(payload);
    if (!claims || claims.tokenType !== 'access') return null;
    return claims as ApexAccessClaims;
  } catch {
    return null;
  }
}

/** Verify signature while tolerating expiry — used to preserve active rooftop on refresh. */
export async function verifyApexAccessTokenLenient(token: string): Promise<ApexAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: APEX_JWT_ISSUER,
      audience: APEX_JWT_AUDIENCE_ACCESS,
      clockTolerance: `${getRefreshTokenTtlSeconds()}s`,
    });
    const claims = parseApexAccessClaims(payload);
    if (!claims || claims.tokenType !== 'access') return null;
    return claims as ApexAccessClaims;
  } catch {
    return null;
  }
}

export async function createPendingSelectionToken(input: {
  technicianId: string;
  credentialType: string;
  sessionVersion: number;
}): Promise<string> {
  const claims: PendingSelectionClaims = {
    tokenType: 'pending_selection',
    technicianId: input.technicianId,
    credentialType: input.credentialType,
    sessionVersion: input.sessionVersion,
  };

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(APEX_JWT_ISSUER)
    .setAudience(APEX_JWT_AUDIENCE_PENDING)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${getPendingSelectionTtlSeconds()}s`)
    .sign(getSecret());

  const expiresAt = new Date(Date.now() + getPendingSelectionTtlSeconds() * 1000);
  await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.create({
      data: {
        technicianId: input.technicianId,
        tokenHash: sha256Hex(token),
        familyId: `pending:${input.technicianId}`,
        expiresAt,
      },
    })
  );

  return token;
}

export async function verifyPendingSelectionToken(
  token: string
): Promise<PendingSelectionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: APEX_JWT_ISSUER,
      audience: APEX_JWT_AUDIENCE_PENDING,
    });
    const claims = parsePendingSelectionClaims(payload);
    if (!claims || claims.tokenType !== 'pending_selection') return null;

    const row = await withRlsBypass(async () =>
      getRlsDb().sessionRefreshToken.findUnique({
        where: { tokenHash: sha256Hex(token) },
        select: { revokedAt: true, expiresAt: true, technicianId: true },
      })
    );
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
    if (row.technicianId !== claims.technicianId) return null;

    return claims;
  } catch {
    return null;
  }
}

export async function consumePendingSelectionToken(token: string): Promise<boolean> {
  const tokenHash = sha256Hex(token);
  const updated = await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    })
  );
  return updated.count === 1;
}

function generateRefreshTokenRaw(): string {
  return randomBytes(48).toString('base64url');
}

export async function issueApexRefreshToken(input: {
  technicianId: string;
  request?: Request;
  familyId?: string;
}): Promise<{ rawToken: string; familyId: string }> {
  const rawToken = generateRefreshTokenRaw();
  const familyId = input.familyId ?? randomUUID();
  const expiresAt = new Date(Date.now() + getRefreshTokenTtlSeconds() * 1000);
  const ip = input.request ? getRequestIp(input.request) : 'unknown';

  await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.create({
      data: {
        technicianId: input.technicianId,
        tokenHash: sha256Hex(rawToken),
        familyId,
        ipHash: hashClientIp(ip),
        userAgentHash: hashUserAgent(input.request?.headers.get('user-agent')),
        expiresAt,
      },
    })
  );

  return { rawToken, familyId };
}

export async function revokeRefreshTokenFamily(familyId: string): Promise<void> {
  await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  );
}

export async function revokeAllRefreshTokensForTechnician(technicianId: string): Promise<void> {
  await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.updateMany({
      where: { technicianId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  );
}

export async function applyApexSessionCookies(
  response: NextResponse,
  input: { accessToken: string; refreshToken: string }
): Promise<void> {
  applyApexAccessCookie(response, input.accessToken);
  applyApexRefreshCookie(response, input.refreshToken);
}

export async function issueApexSessionCookies(
  response: NextResponse,
  session: SessionPayload,
  request: Request,
  options: { authSource?: ApexAuthSource } = {}
): Promise<void> {
  const ipHash = hashClientIp(getRequestIp(request));
  const accessToken = await createApexAccessToken(session, {
    authSource: options.authSource ?? 'legacy',
    ipHash,
  });
  const { rawToken: refreshToken } = await issueApexRefreshToken({
    technicianId: session.technicianId,
    request,
  });
  await applyApexSessionCookies(response, { accessToken, refreshToken });
}

function technicianForSessionFromDealership(
  tech: TechnicianForSession & { dealership: { id: string; name: string; dealerId: string | null } },
  dealership: { id: string; name: string; dealerId: string | null }
): TechnicianForSession {
  return {
    id: tech.id,
    d7Number: tech.d7Number,
    name: tech.name,
    role: tech.role,
    isAdmin: tech.isAdmin,
    dealershipId: dealership.id,
    dealerId: tech.dealerId ?? dealership.dealerId,
    serviceAdvisorId: tech.serviceAdvisorId,
    sessionVersion: tech.sessionVersion,
    consentAt: tech.consentAt,
    consentVersion: tech.consentVersion,
    legalDisclaimerAt: tech.legalDisclaimerAt,
    legalDisclaimerVersion: tech.legalDisclaimerVersion,
    mustChangePassword: tech.mustChangePassword,
    preferredLanguage: tech.preferredLanguage,
    dealership: { name: dealership.name, dealerId: dealership.dealerId },
  };
}

/** Non-owner rooftop sessions always include dealership scope + active rooftop id. */
function buildDealershipScopedTechnicianSession(
  tech: TechnicianForSession & { dealership: { id: string; name: string; dealerId: string | null } },
  dealership: { id: string; name: string; dealerId: string | null }
): SessionPayload {
  const base = buildSessionPayloadFromTechnician(
    technicianForSessionFromDealership(tech, dealership)
  );
  return {
    ...base,
    scopeMode: 'dealership',
    activeDealershipId: dealership.id,
  };
}

async function resolveTechnicianSessionFromClaims(
  claims: ApexAccessClaims
): Promise<SessionPayload | null> {
  return withRlsBypass(async () => {
    const tech = await getRlsDb().technician.findUnique({
      where: { id: claims.technicianId },
      include: { dealership: true },
    });

    if (!tech || !isTechnicianAccountActive(tech)) return null;
    if (tech.sessionVersion !== claims.sessionVersion) return null;
    if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) return null;

    if (tech.role === 'owner') {
      if (claims.scopeMode === 'dealership' && claims.activeDealershipId) {
        // Preserve View As lens across access-token refresh (identity stays owner).
        return buildOwnerDealershipSession(tech.id, claims.activeDealershipId, {
          viewAsRole: claims.viewAsRole,
          viewAsAdmin: claims.viewAsAdmin,
          viewAsServiceAdvisorId: claims.viewAsServiceAdvisorId,
        });
      }
      if (claims.scopeMode === 'group' && claims.activeDealerGroupId) {
        return buildOwnerGroupSession(tech.id, claims.activeDealerGroupId);
      }
      return buildOwnerHomeSession(tech.id);
    }

    const membership = await findActiveDealershipMembership(tech.id, claims.dealershipId, {
      includeDealership: true,
    });
    if (!membership || !('dealership' in membership)) return null;

    return buildDealershipScopedTechnicianSession(
      tech as TechnicianForSession & {
        dealership: { id: string; name: string; dealerId: string | null };
      },
      membership.dealership
    );
  });
}

export async function getApexSessionContext(request?: Request): Promise<{
  session: SessionPayload | null;
  jwtPayload: ApexAccessClaims | null;
}> {
  const token = await readApexAccessToken(request);
  if (!token) return { session: null, jwtPayload: null };

  const jwtPayload = await verifyApexAccessToken(token);
  if (!jwtPayload) return { session: null, jwtPayload: null };

  const session = await resolveTechnicianSessionFromClaims(jwtPayload);
  return { session, jwtPayload };
}

export type RefreshRotationResult =
  | {
      status: 'success';
      session: SessionPayload;
      accessToken: string;
      refreshToken: string;
      authSource: 'refresh';
    }
  | { status: 'invalid' }
  | { status: 'reuse_detected' };

export async function rotateApexRefreshToken(request: Request): Promise<RefreshRotationResult> {
  const rawRefresh = await readApexRefreshToken(request);
  if (!rawRefresh) return { status: 'invalid' };

  return withRlsBypass(async () => {
  const tokenHash = sha256Hex(rawRefresh);
  const row = await getRlsDb().sessionRefreshToken.findUnique({
    where: { tokenHash },
  });

  if (!row) return { status: 'invalid' };

  if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    if (row.revokedAt) {
      await revokeRefreshTokenFamily(row.familyId);
      logger.warn('auth.refresh_reuse_detected', {
        technicianId: row.technicianId,
        familyId: row.familyId,
      });
      return { status: 'reuse_detected' };
    }
    return { status: 'invalid' };
  }

  const tech = await getRlsDb().technician.findUnique({
    where: { id: row.technicianId },
    include: { dealership: true },
  });
  if (!tech || !isTechnicianAccountActive(tech)) {
    await revokeRefreshTokenFamily(row.familyId);
    return { status: 'invalid' };
  }
  if (tech.role === 'service_advisor' && !tech.serviceAdvisorId) {
    await revokeRefreshTokenFamily(row.familyId);
    return { status: 'invalid' };
  }

  await getRlsDb().sessionRefreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });

  let session: SessionPayload | null = null;
  const cookieAccessToken = await readApexAccessToken(request);
  const lenientClaims = cookieAccessToken
    ? await verifyApexAccessTokenLenient(cookieAccessToken)
    : null;

  if (tech.role === 'owner') {
    if (lenientClaims?.scopeMode === 'dealership' && lenientClaims.activeDealershipId) {
      // Preserve View As lens across refresh rotation (same as access-token rebuild).
      session = await buildOwnerDealershipSession(tech.id, lenientClaims.activeDealershipId, {
        viewAsRole: lenientClaims.viewAsRole,
        viewAsAdmin: lenientClaims.viewAsAdmin,
        viewAsServiceAdvisorId: lenientClaims.viewAsServiceAdvisorId,
      });
    } else if (lenientClaims?.scopeMode === 'group' && lenientClaims.activeDealerGroupId) {
      session = await buildOwnerGroupSession(tech.id, lenientClaims.activeDealerGroupId);
    } else {
      session = await buildOwnerHomeSession(tech.id);
    }
  } else if (
    lenientClaims &&
    lenientClaims.technicianId === tech.id
  ) {
    const membership = await findActiveDealershipMembership(tech.id, lenientClaims.dealershipId, {
      includeDealership: true,
    });
    if (membership && 'dealership' in membership) {
      session = buildDealershipScopedTechnicianSession(
        tech as TechnicianForSession & {
          dealership: { id: string; name: string; dealerId: string | null };
        },
        membership.dealership
      );
    } else {
      session = buildDealershipScopedTechnicianSession(
        tech as TechnicianForSession & {
          dealership: { id: string; name: string; dealerId: string | null };
        },
        {
          id: tech.dealershipId,
          name: tech.dealership.name,
          dealerId: tech.dealership.dealerId,
        }
      );
    }
  }

  if (!session) {
    session = buildDealershipScopedTechnicianSession(
      tech as TechnicianForSession & {
        dealership: { id: string; name: string; dealerId: string | null };
      },
      {
        id: tech.dealershipId,
        name: tech.dealership.name,
        dealerId: tech.dealership.dealerId,
      }
    );
  }
  const ipHash = hashClientIp(getRequestIp(request));
  const newAccessToken = await createApexAccessToken(session, {
    authSource: 'refresh',
    scopeMode: session.scopeMode,
    ipHash,
  });
  const { rawToken: refreshToken } = await issueApexRefreshToken({
    technicianId: session.technicianId,
    request,
    familyId: row.familyId,
  });

  return {
    status: 'success',
    session,
    accessToken: newAccessToken,
    refreshToken,
    authSource: 'refresh',
  };
  });
}

export async function destroyApexSession(technicianId?: string): Promise<void> {
  if (technicianId) {
    await revokeAllRefreshTokensForTechnician(technicianId);
  }
}