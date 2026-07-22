import type { TechnicianSession } from '@/types';

/** Minimal auth fetch helpers — kept separate so the login shell never imports @/lib/api. */

const DEFAULT_SESSION_FETCH_TIMEOUT_MS = 8_000;
const LOGIN_TIMEOUT_MS = 15_000;

export type SessionProbeStatus = 'ok' | 'unauthorized' | 'timeout' | 'error';

export type SessionProbeResult =
  | { status: 'ok'; session: TechnicianSession }
  | { status: 'unauthorized' }
  | { status: 'timeout' }
  | { status: 'error'; message: string };

/**
 * Fetch the current session from /api/auth/me with structured status.
 * Timeout is NOT the same as logged-out — callers must not demote to anonymous on timeout.
 */
export async function probeCurrentSession(options?: {
  timeoutMs?: number;
}): Promise<SessionProbeResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SESSION_FETCH_TIMEOUT_MS;

  // Lazy import keeps login bundle free of circular pulls; retries cover cold-start /me.
  const { fetchWithClientRetry } = await import('@/lib/clientFetchRetry');

  try {
    const res = await fetchWithClientRetry('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      timeoutMs,
      maxRetries: 2,
    });
    if (res.status === 401) return { status: 'unauthorized' };
    if (!res.ok) {
      return { status: 'error', message: `Session check failed (${res.status})` };
    }
    const data = (await res.json()) as { session?: TechnicianSession | null };
    if (!data.session) return { status: 'unauthorized' };
    return { status: 'ok', session: data.session };
  } catch (error: unknown) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError') ||
      (error instanceof Error && /timed out/i.test(error.message))
    ) {
      return { status: 'timeout' };
    }
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Session check failed',
    };
  }
}

/**
 * Fetch the current session from /api/auth/me.
 * @deprecated Prefer probeCurrentSession — this collapses timeout into null (looks like logout).
 * Returns null on 401 or missing body. Throws on non-auth network errors.
 * On timeout returns null for backward compat — new code should use probeCurrentSession.
 */
export async function fetchCurrentSession(options?: {
  timeoutMs?: number;
}): Promise<TechnicianSession | null> {
  const result = await probeCurrentSession(options);
  if (result.status === 'ok') return result.session;
  if (result.status === 'error') {
    throw new Error(result.message);
  }
  // unauthorized + timeout → null (legacy)
  return null;
}

export type MerlinLoginResult =
  | { status: 'success'; session: TechnicianSession }
  | { status: 'mfa_required'; mfaToken: string; technicianId: string; name?: string };

export async function loginWithCredentials(
  d7Number: string,
  password: string
): Promise<MerlinLoginResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  try {
    const { CSRF_HEADER, readCsrfTokenFromDocument } = await import('@/lib/csrf');
    const csrf = readCsrfTokenFromDocument();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ d7Number, password }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      session?: TechnicianSession;
      requiresMfa?: boolean;
      mfaToken?: string;
      technicianId?: string;
      name?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || data.message || 'Login failed');
    }
    if (data.requiresMfa && data.mfaToken) {
      return {
        status: 'mfa_required',
        mfaToken: data.mfaToken,
        technicianId: data.technicianId || '',
        name: data.name,
      };
    }
    if (!data.session) {
      throw new Error('Login succeeded but no session was returned');
    }
    // Aggressive bay warm: session + status + today's RO list (technician path)
    void import('@/lib/bayWarmup')
      .then(({ runAggressiveBayWarmup }) =>
        runAggressiveBayWarmup({
          prefetchRoList: true,
          technicianId: data.session!.technicianId,
          dealershipId: data.session!.dealershipId,
        })
      )
      .catch(() =>
        import('@/lib/clientFetchRetry')
          .then(({ warmSessionIsolate }) => warmSessionIsolate())
          .catch(() => undefined)
      );
    return { status: 'success', session: data.session };
  } catch (error: unknown) {
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      throw new Error('Login timed out — check connection and try again');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Complete MFA challenge after password stage. */
export async function verifyMfaLogin(
  mfaToken: string,
  code: string
): Promise<MerlinLoginResult> {
  const { CSRF_HEADER, readCsrfTokenFromDocument } = await import('@/lib/csrf');
  const csrf = readCsrfTokenFromDocument();
  const res = await fetch('/api/auth/mfa/login-verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
    },
    credentials: 'include',
    body: JSON.stringify({ mfaToken, code }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    session?: TechnicianSession;
    requiresDealershipSelection?: boolean;
    pendingToken?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'MFA verification failed');
  }
  if (data.requiresDealershipSelection && data.pendingToken) {
    // Caller (Apex shell) handles dealership selection via pendingToken path —
    // Merlinus single-rooftop should not hit this.
    throw new Error('Dealership selection required after MFA — use Apex login');
  }
  if (!data.session) {
    throw new Error('MFA verified but no session was returned');
  }
  void import('@/lib/bayWarmup')
    .then(({ runAggressiveBayWarmup }) =>
      runAggressiveBayWarmup({
        prefetchRoList: true,
        technicianId: data.session!.technicianId,
        dealershipId: data.session!.dealershipId,
      })
    )
    .catch(() => undefined);
  return { status: 'success', session: data.session };
}

export async function logoutSession(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export interface ClerkLinkStatus {
  clerkEnabled: boolean;
  legacySignedIn: boolean;
  clerkSignedIn: boolean;
  linked: boolean;
  canLink: boolean;
}

export async function fetchClerkLinkStatus(): Promise<ClerkLinkStatus> {
  const res = await fetch('/api/auth/clerk/link', { credentials: 'include', cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as ClerkLinkStatus & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Clerk link status failed (${res.status})`);
  }
  return data;
}

export async function linkClerkAccountSession(): Promise<{
  linked: boolean;
  session: TechnicianSession;
}> {
  const res = await fetch('/api/auth/clerk/link', {
    method: 'POST',
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    linked?: boolean;
    session?: TechnicianSession;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Could not link Clerk account');
  }
  if (!data.session) {
    throw new Error('Clerk link succeeded but no session was returned');
  }
  return { linked: data.linked ?? true, session: data.session };
}

export async function acceptConsentSession(): Promise<TechnicianSession> {
  const res = await fetch('/api/consent', { method: 'POST', credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as {
    consentAt?: string;
    consentVersion?: string;
    session?: TechnicianSession;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || 'Could not save consent');
  if (data.session) return data.session;
  throw new Error('Consent accepted but no session was returned');
}

export async function acceptLegalDisclaimerSession(): Promise<TechnicianSession> {
  const res = await fetch('/api/legal-disclaimer', { method: 'POST', credentials: 'include' });
  const data = (await res.json().catch(() => ({}))) as {
    legalDisclaimerAt?: string;
    legalDisclaimerVersion?: string;
    session?: TechnicianSession;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || 'Could not save legal acknowledgment');
  if (data.session) return data.session;
  throw new Error('Legal disclaimer accepted but no session was returned');
}
