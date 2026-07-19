import type { ApexDealershipOption } from '@/lib/apexDealershipOptions';
import { fetchJsonWithClientRetry, warmOwnerIsolate } from '@/lib/clientFetchRetry';
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
  // Login is not auto-retried on 500 (credential attempts must not stampede).
  // Transport-only retries stay available via one manual re-click.
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

  // Best-effort: warm D1 right after successful owner login so national dashboard is hot.
  if (session.role === 'owner') {
    void warmOwnerIsolate();
  }

  return { status: 'success', session };
}

export async function selectDealershipSession(
  pendingToken: string,
  dealershipId: string,
  rememberAsDefault = false
): Promise<TechnicianSession> {
  const data = await fetchJsonWithClientRetry<LoginResponseBody>('/api/auth/select-dealership', {
    method: 'POST',
    body: JSON.stringify({ pendingToken, dealershipId, rememberAsDefault }),
    timeoutMs: 20_000,
    retryPostServerError: true,
  });

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
  const data = await fetchJsonWithClientRetry<OwnerDealershipsResponse>('/api/owner/dealerships', {
    method: 'GET',
    timeoutMs: 20_000,
  });
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
  const data = await fetchJsonWithClientRetry<{
    groups?: OwnerDealerGroupOption[];
    activeDealerGroupId?: string | null;
    error?: string;
    message?: string;
  }>('/api/owner/dealer-groups', {
    method: 'GET',
    timeoutMs: 15_000,
  });
  return {
    groups: data.groups ?? [],
    activeDealerGroupId: data.activeDealerGroupId ?? null,
  };
}

/** Switch owner portfolio to a DealerGroup, or null for national (platform operators). */
export async function selectOwnerDealerGroup(
  dealerGroupId: string | null
): Promise<TechnicianSession> {
  const data = await fetchJsonWithClientRetry<{
    session?: TechnicianSession;
    error?: string;
    message?: string;
  }>('/api/owner/select-dealer-group', {
    method: 'POST',
    body: JSON.stringify({ dealerGroupId }),
    timeoutMs: 20_000,
    retryPostServerError: true,
  });
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

  const data = await fetchJsonWithClientRetry<{
    session?: TechnicianSession;
    error?: string;
    message?: string;
  }>('/api/auth/enter-dealership', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 25_000,
    // Enter is safe to retry — same rooftop re-entry is idempotent for session mint.
    retryPostServerError: true,
  });

  if (!data.session) {
    throw new Error('Dealership entered but no session was returned');
  }

  // Warm dealership-scoped isolate path after enter (RO list is next).
  void warmOwnerIsolate();

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
  const data = await fetchJsonWithClientRetry<{
    advisors?: OwnerDealershipAdvisorOption[];
    error?: string;
    message?: string;
  }>(`/api/owner/dealership-advisors?${params.toString()}`, {
    method: 'GET',
    timeoutMs: 15_000,
  });
  return data.advisors ?? [];
}

export async function exitOwnerDealership(): Promise<TechnicianSession> {
  const data = await fetchJsonWithClientRetry<{
    session?: TechnicianSession;
    error?: string;
    message?: string;
  }>('/api/auth/exit-dealership', {
    method: 'POST',
    timeoutMs: 20_000,
    retryPostServerError: true,
  });

  if (!data.session) {
    throw new Error('Dealership exited but no session was returned');
  }

  void warmOwnerIsolate();
  return data.session;
}

/** Prefetch enterable rooftops so the first “View as / enter” click is warm. */
export async function prefetchOwnerDealerships(): Promise<ApexDealershipOption[]> {
  try {
    return await fetchOwnerDealerships();
  } catch {
    return [];
  }
}
