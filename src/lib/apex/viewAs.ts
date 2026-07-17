/**
 * National Owner "View As" — effective role lens without mutating owner identity.
 * Client-safe (no server-only): used by UI shells and server guards.
 */

export type ViewAsStaffRole = 'technician' | 'manager' | 'service_advisor';

/** Labels shown in the National Owner dual selector. */
export const VIEW_AS_ROLE_OPTIONS: Array<{
  value: ViewAsStaffRole | 'dealership_owner' | 'general_manager';
  label: string;
  description: string;
}> = [
  { value: 'technician', label: 'Technician', description: 'Bay tech RO queue and story tools' },
  { value: 'service_advisor', label: 'Service Advisor', description: 'Advisor sold-metrics dashboard' },
  { value: 'manager', label: 'Service Manager', description: 'Rooftop manager console' },
  { value: 'general_manager', label: 'General Manager', description: 'Manager console with admin privileges' },
  { value: 'dealership_owner', label: 'Dealership Owner', description: 'Native owner lens in this rooftop' },
];

export type ViewAsSessionFields = {
  role: string;
  isAdmin?: boolean;
  isOwner?: boolean;
  scopeMode?: 'national' | 'group' | 'dealership' | string;
  viewAsRole?: ViewAsStaffRole | null;
  viewAsAdmin?: boolean;
  viewAsServiceAdvisorId?: string | null;
  serviceAdvisorId?: string | null;
};

export function isOwnerDealershipView(session: ViewAsSessionFields): boolean {
  return session.role === 'owner' && session.scopeMode === 'dealership';
}

/** Role used for UI branching and access helpers while Viewing As. */
export function effectiveRole(session: ViewAsSessionFields): string {
  if (isOwnerDealershipView(session) && session.viewAsRole) {
    return session.viewAsRole;
  }
  return session.role;
}

/** Admin privilege for GM lens (session flag only — never rewrites DB isAdmin). */
export function effectiveIsAdmin(session: ViewAsSessionFields): boolean {
  if (isOwnerDealershipView(session)) {
    // GM lens only
    if (session.viewAsAdmin && session.viewAsRole === 'manager') return true;
    // Explicit staff lenses never inherit owner seed isAdmin
    if (session.viewAsRole) return false;
    // Native dealership-owner lens may use seed isAdmin in rooftop context
    return Boolean(session.isAdmin);
  }
  return Boolean(session.isAdmin);
}

export function effectiveServiceAdvisorId(session: ViewAsSessionFields): string | null {
  if (effectiveRole(session) === 'service_advisor') {
    return session.viewAsServiceAdvisorId?.trim() || session.serviceAdvisorId || null;
  }
  return session.serviceAdvisorId ?? null;
}

export function viewAsRoleLabel(session: ViewAsSessionFields): string {
  if (!isOwnerDealershipView(session)) return '';
  if (session.viewAsAdmin && session.viewAsRole === 'manager') return 'General Manager';
  if (session.viewAsRole === 'manager') return 'Service Manager';
  if (session.viewAsRole === 'service_advisor') return 'Service Advisor';
  if (session.viewAsRole === 'technician') return 'Technician';
  return 'Dealership Owner';
}

/** Map UI dropdown value → session lens claims. */
export function resolveViewAsClaims(selection: {
  role: ViewAsStaffRole | 'dealership_owner' | 'general_manager';
  serviceAdvisorId?: string | null;
}): {
  viewAsRole: ViewAsStaffRole | null;
  viewAsAdmin: boolean;
  viewAsServiceAdvisorId: string | null;
} {
  if (selection.role === 'dealership_owner') {
    return { viewAsRole: null, viewAsAdmin: false, viewAsServiceAdvisorId: null };
  }
  if (selection.role === 'general_manager') {
    return { viewAsRole: 'manager', viewAsAdmin: true, viewAsServiceAdvisorId: null };
  }
  if (selection.role === 'service_advisor') {
    return {
      viewAsRole: 'service_advisor',
      viewAsAdmin: false,
      viewAsServiceAdvisorId: selection.serviceAdvisorId?.trim() || null,
    };
  }
  return {
    viewAsRole: selection.role,
    viewAsAdmin: false,
    viewAsServiceAdvisorId: null,
  };
}
