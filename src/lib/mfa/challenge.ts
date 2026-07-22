/**
 * Short-lived pending MFA challenge tokens (password OK → MFA still required).
 * Mirrors pending dealership selection: JWT + one-time DB row.
 */
import 'server-only';

import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import {
  APEX_JWT_ISSUER,
  sha256Hex,
} from '@/lib/apex/apexSession';
import { getRlsDb, withRlsBypass } from '@/lib/apex/rlsContext';

export const APEX_JWT_AUDIENCE_MFA = 'benz-tech-apex-mfa';
const DEFAULT_MFA_CHALLENGE_TTL_SECONDS = 5 * 60;

export interface PendingMfaClaims {
  tokenType: 'pending_mfa';
  technicianId: string;
  sessionVersion: number;
  credentialType: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export function getMfaChallengeTtlSeconds(): number {
  const raw = Number(process.env.MFA_CHALLENGE_TTL_SECONDS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MFA_CHALLENGE_TTL_SECONDS;
}

export async function createPendingMfaToken(input: {
  technicianId: string;
  sessionVersion: number;
  credentialType?: string;
}): Promise<string> {
  const claims: PendingMfaClaims = {
    tokenType: 'pending_mfa',
    technicianId: input.technicianId,
    sessionVersion: input.sessionVersion,
    credentialType: input.credentialType || 'password',
  };

  const token = await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(APEX_JWT_ISSUER)
    .setAudience(APEX_JWT_AUDIENCE_MFA)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${getMfaChallengeTtlSeconds()}s`)
    .sign(getSecret());

  const expiresAt = new Date(Date.now() + getMfaChallengeTtlSeconds() * 1000);
  await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.create({
      data: {
        technicianId: input.technicianId,
        tokenHash: sha256Hex(token),
        familyId: `mfa:${input.technicianId}`,
        expiresAt,
      },
    })
  );

  return token;
}

export async function verifyPendingMfaToken(
  token: string
): Promise<PendingMfaClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: APEX_JWT_ISSUER,
      audience: APEX_JWT_AUDIENCE_MFA,
    });
    if (payload.tokenType !== 'pending_mfa') return null;
    const technicianId =
      typeof payload.technicianId === 'string' ? payload.technicianId : '';
    const sessionVersion = Number(payload.sessionVersion);
    if (!technicianId || !Number.isFinite(sessionVersion)) return null;

    const row = await withRlsBypass(async () =>
      getRlsDb().sessionRefreshToken.findUnique({
        where: { tokenHash: sha256Hex(token) },
        select: { revokedAt: true, expiresAt: true, technicianId: true },
      })
    );
    if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
    if (row.technicianId !== technicianId) return null;

    return {
      tokenType: 'pending_mfa',
      technicianId,
      sessionVersion,
      credentialType:
        typeof payload.credentialType === 'string' ? payload.credentialType : 'password',
    };
  } catch {
    return null;
  }
}

export async function consumePendingMfaToken(token: string): Promise<boolean> {
  const tokenHash = sha256Hex(token);
  const updated = await withRlsBypass(async () =>
    getRlsDb().sessionRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    })
  );
  return updated.count === 1;
}
