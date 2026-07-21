/**
 * P1-3 — MFA enforcement policy for manager / owner / admin roles.
 *
 * Off by default. Enable with MERLIN_MFA_ENFORCE=true (or 1).
 * Optional role list: MERLIN_MFA_REQUIRED_ROLES=manager,owner,admin
 */

const DEFAULT_MFA_ROLES = new Set(['manager', 'owner', 'admin']);

export function isMfaEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = env.MERLIN_MFA_ENFORCE?.trim().toLowerCase() ?? '';
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function parseMfaRequiredRoles(
  env: NodeJS.ProcessEnv = process.env
): Set<string> {
  const raw = env.MERLIN_MFA_REQUIRED_ROLES?.trim();
  if (!raw) return new Set(DEFAULT_MFA_ROLES);
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const r = part.trim().toLowerCase();
    if (r) set.add(r);
  }
  return set.size > 0 ? set : new Set(DEFAULT_MFA_ROLES);
}

export function roleRequiresMfaEnrollment(
  role: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!isMfaEnforcementEnabled(env)) return false;
  const r = (role || '').trim().toLowerCase();
  if (!r) return false;
  // isAdmin handled separately by callers
  return parseMfaRequiredRoles(env).has(r);
}

export interface MfaSessionFlags {
  mfaEnabled: boolean;
  mfaEnrolled: boolean;
  /** True when this session must complete MFA enrollment before PII routes. */
  mfaRequired: boolean;
}

export function buildMfaSessionFlags(input: {
  role: string;
  isAdmin?: boolean;
  mfaEnabled?: boolean | null;
  mfaEnrolledAt?: Date | string | null;
  env?: NodeJS.ProcessEnv;
}): MfaSessionFlags {
  const env = input.env ?? process.env;
  const enrolled = Boolean(
    input.mfaEnabled && input.mfaEnrolledAt
  );
  const roleNeeds =
    roleRequiresMfaEnrollment(input.role, env) ||
    (Boolean(input.isAdmin) && parseMfaRequiredRoles(env).has('admin'));
  return {
    mfaEnabled: Boolean(input.mfaEnabled),
    mfaEnrolled: enrolled,
    mfaRequired: roleNeeds && !enrolled && isMfaEnforcementEnabled(env),
  };
}

export const MFA_REQUIRED_ERROR =
  'Multi-factor authentication enrollment is required for your role. Complete MFA setup to continue.';
