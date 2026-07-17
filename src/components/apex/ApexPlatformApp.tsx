'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApexLoadingScreen } from '@/components/apex/ApexLoadingScreen';
import { ApexLoginShell, type ApexLoginShellResult } from '@/components/apex/ApexLoginShell';
import { ApexOwnerDealershipWorkspace } from '@/components/apex/ApexOwnerDealershipWorkspace';
import { ApexOwnerNationalShell } from '@/components/apex/ApexOwnerNationalShell';
import { ConsentModal } from '@/components/ConsentModal';
import { ForcedPasswordChangeScreen } from '@/components/ForcedPasswordChangeScreen';
import { LegalDisclaimerModal } from '@/components/LegalDisclaimerModal';
import {
  loginWithIdentifier,
  selectDealershipSession,
} from '@/lib/apexLoginSession';
import { clientLog } from '@/lib/clientLog';
import { needsConsent, needsLegalDisclaimer, needsPasswordChange } from '@/lib/complianceSession';
import {
  acceptConsentSession,
  acceptLegalDisclaimerSession,
  probeCurrentSession,
} from '@/lib/authClient';
import { useMerlinLogout } from '@/hooks/useMerlinLogout';
import { cacheLegalDisclaimerLocally } from '@/lib/legalDisclaimer';
import type { TechnicianSession } from '@/types';

const BenzTechAuthenticatedApp = dynamic(
  () =>
    import('@/components/BenzTechAuthenticatedApp').then((m) => m.BenzTechAuthenticatedApp),
  {
    loading: () => (
      <ApexLoadingScreen
        label="Loading workspace"
        sublabel="Preparing dealership tools…"
      />
    ),
    ssr: false,
  }
);

type SessionPhase = 'checking' | 'anonymous' | 'authenticated';

/** Normalize owner home fields so routing never misses group/national console. */
function normalizeClientSession(session: TechnicianSession): TechnicianSession {
  if (session.role !== 'owner') {
    return {
      ...session,
      scopeMode: session.scopeMode ?? 'dealership',
      isOwner: false,
    };
  }
  const scopeMode =
    session.scopeMode === 'dealership'
      ? 'dealership'
      : session.scopeMode === 'group'
        ? 'group'
        : 'national';
  return {
    ...session,
    scopeMode,
    isOwner: true,
    // Clear stale active rooftop when on group/platform home
    activeDealershipId: scopeMode === 'dealership' ? session.activeDealershipId : undefined,
  };
}

/** Owner home console (platform national or DealerGroup). */
function isOwnerHomeScope(session: TechnicianSession): boolean {
  if (session.role !== 'owner') return false;
  const scope = session.scopeMode ?? 'national';
  return scope === 'national' || scope === 'group';
}

function isOwnerDealershipScope(session: TechnicianSession): boolean {
  return session.role === 'owner' && session.scopeMode === 'dealership';
}

export function ApexPlatformApp() {
  const merlinLogout = useMerlinLogout();
  const [session, setSession] = useState<TechnicianSession | null>(null);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('checking');
  const [consentLoading, setConsentLoading] = useState(false);
  const [legalDisclaimerLoading, setLegalDisclaimerLoading] = useState(false);
  /** When true, soft refresh must not demote an authenticated password login. */
  const holdAuthenticatedRef = useRef(false);

  const applySession = useCallback((next: TechnicianSession) => {
    const normalized = normalizeClientSession(next);
    setSession(normalized);
    setSessionPhase('authenticated');
    holdAuthenticatedRef.current = true;
  }, []);

  /**
   * Soft session refresh from /api/auth/me.
   * - clearOnMissing: only for cold start (no password session yet)
   * - never leaves the user on "checking" forever (fetchCurrentSession times out)
   */
  const refreshSession = useCallback(
    async (options?: { clearOnMissing?: boolean }): Promise<TechnicianSession | null> => {
      const clearOnMissing = options?.clearOnMissing ?? !holdAuthenticatedRef.current;
      try {
        const result = await probeCurrentSession({ timeoutMs: 8_000 });
        if (result.status === 'ok') {
          applySession(result.session);
          return result.session;
        }
        if (result.status === 'timeout' || result.status === 'error') {
          clientLog.warn('auth.session_refresh_soft_fail', { status: result.status });
          // Never demote on timeout — cold DB must not look like logout.
          return null;
        }
        if (clearOnMissing && !holdAuthenticatedRef.current) {
          setSession(null);
          setSessionPhase('anonymous');
        }
        // Keep existing authenticated session if cookie probe failed after login.
        return null;
      } catch (error: unknown) {
        clientLog.error('auth.session_refresh_failed', error);
        if (clearOnMissing && !holdAuthenticatedRef.current) {
          setSession(null);
          setSessionPhase('anonymous');
        }
        return null;
      }
    },
    [applySession]
  );

  useEffect(() => {
    let cancelled = false;

    // Cold start: leave "checking" as soon as me returns or times out.
    // Timeout retries once — never treat a slow DB as logged-out on first paint.
    void (async () => {
      let result = await probeCurrentSession({ timeoutMs: 8_000 });
      if (cancelled) return;
      if (result.status === 'ok') {
        applySession(result.session);
        return;
      }
      if (result.status === 'timeout' || result.status === 'error') {
        clientLog.warn('auth.session_check_retry', { status: result.status });
        result = await probeCurrentSession({ timeoutMs: 12_000 });
        if (cancelled) return;
        if (result.status === 'ok') {
          applySession(result.session);
          return;
        }
      }
      setSessionPhase('anonymous');
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<ApexLoginShellResult> => {
      const result = await loginWithIdentifier(identifier, password);
      if (result.status === 'select_dealership') {
        return {
          status: 'select_dealership',
          pendingToken: result.pendingToken,
          dealerships: result.dealerships,
        };
      }

      // Immediate transition off login / checking using the login response body.
      // Do not block on /api/auth/me (Clerk dual-mode + cookie races caused hang loops).
      applySession(result.session);
      // Soft revalidate only — must not clear the session we just applied.
      void refreshSession({ clearOnMissing: false });
      return { status: 'success' };
    },
    [applySession, refreshSession]
  );

  const selectDealership = useCallback(
    async (pendingToken: string, dealershipId: string, rememberAsDefault = false) => {
      const next = await selectDealershipSession(pendingToken, dealershipId, rememberAsDefault);
      applySession(next);
      void refreshSession({ clearOnMissing: false });
    },
    [applySession, refreshSession]
  );

  const logout = useCallback(async () => {
    holdAuthenticatedRef.current = false;
    await merlinLogout();
    setSession(null);
    setSessionPhase('anonymous');
  }, [merlinLogout]);

  if (sessionPhase === 'checking') {
    return (
      <div data-platform="apex" className="apex-app-root min-h-dvh apex-platform-stage">
        <ApexLoadingScreen
          label="Checking session"
          sublabel="Verifying secure platform access…"
        />
      </div>
    );
  }

  if (sessionPhase !== 'authenticated' || !session) {
    return <ApexLoginShell onLogin={login} onSelectDealership={selectDealership} />;
  }

  if (needsPasswordChange(session)) {
    return (
      <ForcedPasswordChangeScreen
        userName={session.name}
        rooftopName={session.dealershipName}
        onCompleted={async () => {
          await logout();
        }}
        onLogout={logout}
      />
    );
  }

  if (needsConsent(session)) {
    return (
      <div data-platform="apex" className="apex-app-root min-h-dvh apex-platform-stage">
        <ConsentModal
          loading={consentLoading}
          onAccept={async () => {
            setConsentLoading(true);
            try {
              const accepted = await acceptConsentSession();
              applySession(accepted);
            } catch (error: unknown) {
              clientLog.error('compliance.consent_accept_failed', error);
              toast.error(error instanceof Error ? error.message : 'Could not save consent — try again');
            } finally {
              setConsentLoading(false);
            }
          }}
        />
      </div>
    );
  }

  if (needsLegalDisclaimer(session)) {
    return (
      <div data-platform="apex" className="apex-app-root min-h-dvh apex-platform-stage">
        <LegalDisclaimerModal
          loading={legalDisclaimerLoading}
          onAccept={async () => {
            setLegalDisclaimerLoading(true);
            try {
              const accepted = await acceptLegalDisclaimerSession();
              cacheLegalDisclaimerLocally(accepted.technicianId);
              applySession(accepted);
              void refreshSession({ clearOnMissing: false });
            } catch (error: unknown) {
              clientLog.error('compliance.legal_disclaimer_accept_failed', error);
              toast.error(
                error instanceof Error ? error.message : 'Could not save legal acknowledgment — try again'
              );
            } finally {
              setLegalDisclaimerLoading(false);
            }
          }}
        />
      </div>
    );
  }

  if (isOwnerHomeScope(session)) {
    return (
      <ApexOwnerNationalShell
        session={session}
        onLogout={logout}
        onSessionRefresh={() => refreshSession({ clearOnMissing: false })}
        onSessionApplied={applySession}
      />
    );
  }

  if (isOwnerDealershipScope(session)) {
    return (
      <ApexOwnerDealershipWorkspace
        session={session}
        onLogout={logout}
        onSessionRefresh={() => refreshSession({ clearOnMissing: false })}
        onSessionApplied={applySession}
        AuthenticatedApp={BenzTechAuthenticatedApp}
      />
    );
  }

  return (
    <div data-platform="apex" className="apex-app-root min-h-dvh apex-platform-stage">
      <BenzTechAuthenticatedApp
        session={session}
        onLogout={logout}
        onSessionRefresh={() => refreshSession({ clearOnMissing: false })}
      />
    </div>
  );
}
