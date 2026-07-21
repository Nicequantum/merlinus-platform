/**
 * P2-5 — Password strength policy for staff accounts.
 *
 * Technicians: min length 8 (existing).
 * Manager / owner / admin roles: min 12 + complexity (upper, lower, digit).
 * Optional common-password blocklist (small local list — not full HIBP).
 */

export type PasswordPolicyRole =
  | 'technician'
  | 'manager'
  | 'owner'
  | 'admin'
  | 'service_advisor'
  | 'parts'
  | 'sales'
  | 'service'
  | 'maintenance'
  | 'loaner'
  | string;

/** Roles that get the stronger password bar. */
export const ELEVATED_PASSWORD_ROLES = new Set([
  'manager',
  'owner',
  'admin',
]);

/** Small deny-list of trivial passwords (case-insensitive). */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    'changeme',
    'changeme1',
    'mercedes',
    'dealership',
    'welcome1',
    'letmein',
    'qwerty',
    'qwerty123',
    '12345678',
    '123456789',
    '1234567890',
    'admin123',
    'manager1',
    'dealer123',
    'temp1234',
    'password!',
  ].map((s) => s.toLowerCase())
);

export interface PasswordPolicyResult {
  ok: boolean;
  errors: string[];
  minLength: number;
  elevated: boolean;
}

export function isElevatedPasswordRole(role: PasswordPolicyRole | null | undefined): boolean {
  const r = (role || '').trim().toLowerCase();
  if (!r) return false;
  if (ELEVATED_PASSWORD_ROLES.has(r)) return true;
  return false;
}

export function evaluatePasswordPolicy(
  password: string,
  options?: {
    role?: PasswordPolicyRole | null;
    /** Force elevated rules even for technician (e.g. isAdmin). */
    elevated?: boolean;
    /** Min length override. */
    minLength?: number;
  }
): PasswordPolicyResult {
  const elevated =
    options?.elevated === true || isElevatedPasswordRole(options?.role);
  const minLength = options?.minLength ?? (elevated ? 12 : 8);
  const errors: string[] = [];
  const pw = password ?? '';

  if (pw.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters`);
  }
  if (pw.length > 128) {
    errors.push('Password must be at most 128 characters');
  }

  if (elevated) {
    if (!/[a-z]/.test(pw)) {
      errors.push('Password must include a lowercase letter');
    }
    if (!/[A-Z]/.test(pw)) {
      errors.push('Password must include an uppercase letter');
    }
    if (!/[0-9]/.test(pw)) {
      errors.push('Password must include a number');
    }
  }

  const normalized = pw.trim().toLowerCase();
  if (normalized && COMMON_PASSWORDS.has(normalized)) {
    errors.push('Password is too common — choose a stronger unique password');
  }

  // Block simple sequences for elevated accounts
  if (elevated && /^(.)\1{7,}$/.test(pw)) {
    errors.push('Password cannot be a single repeated character');
  }

  return {
    ok: errors.length === 0,
    errors,
    minLength,
    elevated,
  };
}

/** Zod-friendly refine helper — returns first error message or null. */
export function passwordPolicyIssue(
  password: string,
  options?: Parameters<typeof evaluatePasswordPolicy>[1]
): string | null {
  const result = evaluatePasswordPolicy(password, options);
  return result.ok ? null : result.errors[0] ?? 'Password does not meet policy';
}
