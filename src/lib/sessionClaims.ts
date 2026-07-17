/**
 * Phase 7.1 (H13) — Zod validation of JWT claims after jose verification.
 * Rejects malformed claim shapes instead of trusting `as SessionPayload` casts.
 */
import { z } from 'zod';

export const USER_ROLES = ['technician', 'manager', 'service_advisor', 'owner', 'admin'] as const;

const scopeModeSchema = z.enum(['national', 'group', 'dealership']);
const apexAuthSourceSchema = z.enum(['legacy', 'clerk', 'refresh']);

/** Core app session claims (legacy Merlin JWT + Apex access subset). */
const sessionPayloadObjectSchema = z.object({
  technicianId: z.string().min(1),
  d7Number: z.string().nullable().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  isAdmin: z.boolean(),
  dealershipId: z.string().min(1),
  dealershipName: z.string(),
  dealerId: z.string().nullable().optional(),
  serviceAdvisorId: z.string().nullable().optional(),
  consentAt: z.string().nullable().optional(),
  consentVersion: z.string().nullable().optional(),
  legalDisclaimerAt: z.string().nullable().optional(),
  legalDisclaimerVersion: z.string().nullable().optional(),
  sessionVersion: z.coerce.number().int().nonnegative(),
  scopeMode: scopeModeSchema.optional(),
  isOwner: z.boolean().optional(),
  activeDealershipId: z.string().optional(),
  activeDealerGroupId: z.string().optional(),
  dealerGroupName: z.string().optional(),
  mustChangePassword: z.boolean().optional(),
  dealershipTimezone: z.string().optional(),
  viewAsRole: z.enum(['technician', 'manager', 'service_advisor']).nullable().optional(),
  viewAsAdmin: z.boolean().optional(),
  viewAsServiceAdvisorId: z.string().nullable().optional(),
  preferredLanguage: z.string().min(1).max(16).optional(),
});

export type ParsedSessionPayload = {
  technicianId: string;
  d7Number: string | null;
  name: string;
  role: string;
  isAdmin: boolean;
  dealershipId: string;
  dealershipName: string;
  dealerId: string | null;
  serviceAdvisorId: string | null;
  consentAt: string | null;
  consentVersion: string | null;
  legalDisclaimerAt: string | null;
  legalDisclaimerVersion: string | null;
  sessionVersion: number;
  scopeMode?: 'national' | 'group' | 'dealership';
  isOwner?: boolean;
  activeDealershipId?: string;
  activeDealerGroupId?: string;
  dealerGroupName?: string;
  mustChangePassword?: boolean;
  dealershipTimezone?: string;
  viewAsRole?: 'technician' | 'manager' | 'service_advisor' | null;
  viewAsAdmin?: boolean;
  viewAsServiceAdvisorId?: string | null;
  preferredLanguage?: string;
};

export type ParsedApexAccessClaims = ParsedSessionPayload & {
  tokenType: 'access';
  scopeMode: 'national' | 'group' | 'dealership';
  authSource: 'legacy' | 'clerk' | 'refresh';
  ipHash: string | null;
};

export type ParsedPendingSelectionClaims = {
  tokenType: 'pending_selection';
  technicianId: string;
  credentialType: string;
  sessionVersion: number;
};

function normalizeSessionPayload(
  raw: z.infer<typeof sessionPayloadObjectSchema>
): ParsedSessionPayload {
  return {
    technicianId: raw.technicianId.trim(),
    d7Number: raw.d7Number ?? null,
    name: raw.name,
    role: raw.role,
    isAdmin: Boolean(raw.isAdmin),
    dealershipId: raw.dealershipId.trim(),
    dealershipName: raw.dealershipName,
    dealerId: raw.dealerId?.trim() || null,
    serviceAdvisorId: raw.serviceAdvisorId ?? null,
    consentAt: raw.consentAt ?? null,
    consentVersion: raw.consentVersion ?? null,
    legalDisclaimerAt: raw.legalDisclaimerAt ?? null,
    legalDisclaimerVersion: raw.legalDisclaimerVersion ?? null,
    sessionVersion: raw.sessionVersion,
    scopeMode: raw.scopeMode,
    isOwner: raw.isOwner,
    activeDealershipId: raw.activeDealershipId?.trim() || undefined,
    activeDealerGroupId: raw.activeDealerGroupId?.trim() || undefined,
    dealerGroupName: raw.dealerGroupName,
    mustChangePassword: raw.mustChangePassword,
    dealershipTimezone: raw.dealershipTimezone?.trim() || undefined,
    viewAsRole: raw.viewAsRole === undefined ? undefined : raw.viewAsRole,
    viewAsAdmin: raw.viewAsAdmin,
    viewAsServiceAdvisorId:
      raw.viewAsServiceAdvisorId === undefined
        ? undefined
        : raw.viewAsServiceAdvisorId?.trim() || null,
    preferredLanguage: raw.preferredLanguage?.trim() || undefined,
  };
}

/** Parse JWT payload object after successful jose verify. Returns null on shape mismatch. */
export function parseSessionPayloadClaims(payload: unknown): ParsedSessionPayload | null {
  const result = sessionPayloadObjectSchema.safeParse(payload);
  if (!result.success) return null;
  return normalizeSessionPayload(result.data);
}

export function parseApexAccessClaims(payload: unknown): ParsedApexAccessClaims | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  if (obj.tokenType !== 'access') return null;

  const session = parseSessionPayloadClaims(payload);
  if (!session) return null;

  const scopeMode = scopeModeSchema.safeParse(obj.scopeMode ?? session.scopeMode);
  const authSource = apexAuthSourceSchema.safeParse(obj.authSource);
  if (!scopeMode.success || !authSource.success) return null;

  const ipHash =
    obj.ipHash === null || obj.ipHash === undefined
      ? null
      : typeof obj.ipHash === 'string'
        ? obj.ipHash
        : null;

  return {
    ...session,
    tokenType: 'access',
    scopeMode: scopeMode.data,
    authSource: authSource.data,
    ipHash,
  };
}

export function parsePendingSelectionClaims(payload: unknown): ParsedPendingSelectionClaims | null {
  const result = z
    .object({
      tokenType: z.literal('pending_selection'),
      technicianId: z.string().min(1),
      credentialType: z.string().min(1),
      sessionVersion: z.coerce.number().int().nonnegative(),
    })
    .safeParse(payload);
  return result.success ? result.data : null;
}
