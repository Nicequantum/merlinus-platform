import type { ApexDealershipOption } from '@/lib/apexDealershipOptions';
import type { TechnicianSession } from '@/types';

/** Minimal Apex auth fetch helpers — kept separate from @/lib/api (login shell bundle). */

export type ApexLoginDealershipOption = ApexDealershipOption & { isPrimary: boolean };

export type ApexLoginResult =
  | { status: 'success'; session: TechnicianSession }
  | {
      status: 'select_dealership';
      pendingToken: string;
      dealerships: ApexLoginDealershipOption[];
    };

type LoginResponseBody = {
  session?: TechnicianSession;
  requiresDealershipSelection?: boolean;
  pendingToken?: string;
  dealerships?: ApexLoginDealershipOption[];
  error?: string;
  message?: string;
};

export async function loginWithIdentifier(
  identifier: string,
  password: string
): Promise<ApexLoginResult> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ identifier: identifier.trim(), password }),
  });

  const data = (await res.json().catch(() => ({}))) as LoginResponseBody;
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Login failed');
  }

  if (data.requiresDealershipSelection && data.pendingToken && data.dealerships?.length) {
    return {
      status: 'select_dealership',
      pendingToken: data.pendingToken,
      dealerships: data.dealerships,
    };
  }

  if (!data.session) {
    throw new Error('Login succeeded but no session was returned');
  }

  // Normalize owner home routing — preserve group scope (PR-G2).
  const session: TechnicianSession =
    data.session.role === 'owner'
      ? {
          ...data.session,
          scopeMode:
            data.session.scopeMode === 'dealership'
              ? 'dealership'
              : data.session.scopeMode === 'group'
                ? 'group'
                : 'national',
          isOwner: true,
        }
      : data.session;

  return { status: 'success', session };
}

export async function selectDealershipSession(
  pendingToken: string,
  dealershipId: string,
  rememberAsDefault = false
): Promise<TechnicianSession> {
  const res = await fetch('/api/auth/select-dealership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ pendingToken, dealershipId, rememberAsDefault }),
  });

  const data = (await res.json().catch(() => ({}))) as LoginResponseBody;
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Dealership selection failed');
  }

  if (!data.session) {
    throw new Error('Dealership selected but no session was returned');
  }

  return data.session;
}

type OwnerDealershipsResponse = {
  dealerships?: ApexDealershipOption[];
  error?: string;
  message?: string;
};

export async function fetchOwnerDealerships(): Promise<ApexDealershipOption[]> {
  const res = await fetch('/api/owner/dealerships', {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as OwnerDealershipsResponse;
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not load dealerships');
  }
  return data.dealerships ?? [];
}

export type OwnerDealerGroupOption = {
  id: string;
  code: string;
  name: string;
  legalName: string | null;
  role: string;
  isPrimary: boolean;
};

export async function fetchOwnerDealerGroups(): Promise<{
  groups: OwnerDealerGroupOption[];
  activeDealerGroupId: string | null;
}> {
  const res = await fetch('/api/owner/dealer-groups', {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as {
    groups?: OwnerDealerGroupOption[];
    activeDealerGroupId?: string | null;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not load dealer groups');
  }
  return {
    groups: data.groups ?? [],
    activeDealerGroupId: data.activeDealerGroupId ?? null,
  };
}

/** Switch owner portfolio to a DealerGroup, or null for national (platform operators). */
export async function selectOwnerDealerGroup(
  dealerGroupId: string | null
): Promise<TechnicianSession> {
  const res = await fetch('/api/owner/select-dealer-group', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ dealerGroupId }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    session?: TechnicianSession;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not switch dealer group');
  }
  if (!data.session) {
    throw new Error('Group selected but no session was returned');
  }
  return data.session;
}

export type OwnerViewAsUiRole =
  | 'technician'
  | 'manager'
  | 'service_advisor'
  | 'dealership_owner'
  | 'general_manager';

export type EnterOwnerDealershipOptions = {
  viewAsRole?: OwnerViewAsUiRole;
  viewAsServiceAdvisorId?: string | null;
};

export async function enterOwnerDealership(
  dealershipId: string,
  options?: EnterOwnerDealershipOptions
): Promise<TechnicianSession> {
  const body: {
    dealershipId: string;
    viewAsRole?: OwnerViewAsUiRole;
    viewAsServiceAdvisorId?: string;
  } = { dealershipId };

  if (options?.viewAsRole) {
    body.viewAsRole = options.viewAsRole;
  }
  if (options?.viewAsServiceAdvisorId?.trim()) {
    body.viewAsServiceAdvisorId = options.viewAsServiceAdvisorId.trim();
  }

  const res = await fetch('/api/auth/enter-dealership', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as {
    session?: TechnicianSession;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not enter dealership');
  }

  if (!data.session) {
    throw new Error('Dealership entered but no session was returned');
  }

  return data.session;
}

export type OwnerDealershipAdvisorOption = {
  id: string;
  displayName: string;
  advisorCode: string | null;
};

/** National/group home — list advisors for View As service-advisor lens. */
export async function fetchOwnerDealershipAdvisors(
  dealershipId: string
): Promise<OwnerDealershipAdvisorOption[]> {
  const params = new URLSearchParams({ dealershipId });
  const res = await fetch(`/api/owner/dealership-advisors?${params.toString()}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as {
    advisors?: OwnerDealershipAdvisorOption[];
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not load service advisors');
  }
  return data.advisors ?? [];
}

export async function exitOwnerDealership(): Promise<TechnicianSession> {
  const res = await fetch('/api/auth/exit-dealership', {
    method: 'POST',
    credentials: 'include',
  });

  const data = (await res.json().catch(() => ({}))) as {
    session?: TechnicianSession;
    error?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not exit dealership');
  }

  if (!data.session) {
    throw new Error('Dealership exited but no session was returned');
  }

  return data.session;
}