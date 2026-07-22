'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConsentModal } from '@/components/ConsentModal';
import { ForcedMfaEnrollScreen } from '@/components/ForcedMfaEnrollScreen';
import { ForcedPasswordChangeScreen } from '@/components/ForcedPasswordChangeScreen';
import { LegalDisclaimerModal } from '@/components/LegalDisclaimerModal';
import { LoginView } from '@/components/LoginView';
import { LoadingScreen } from '@/components/LoadingScreen';
import { useMerlinLogout } from '@/hooks/useMerlinLogout';
import {
  acceptConsentSession,
  acceptLegalDisclaimerSession,
  fetchClerkLinkStatus,
  linkClerkAccountSession,
  loginWithCredentials,
  probeCurrentSession,
  verifyMfaLogin,
} from '@/lib/authClient';
import { isClerkSignInAvailable, shouldUseClerkOnlyLogin } from '@/lib/authModeClient';
import { clientLog } from '@/lib/clientLog';
import {
  needsConsent,
  needsLegalDisclaimer,
  needsMfaEnrollment,
  needsPasswordChange,
} from '@/lib/complianceSession';
import { cacheLegalDisclaimerLocally } from '@/lib/legalDisclaimer';
import type { TechnicianSession } from '@/types';

const BenzTechAuthenticatedApp = dynamic(
  () =>
    import('@/components/BenzTechAuthenticatedApp').then((m) => m.BenzTechAuthenticatedApp),
  {
    loading: () => (
      <LoadingScreen
        label="Starting Merlinus"
        sublabel="Loading warranty documentation tools…"
      />
    ),
    ssr: false,
  }
);

type SessionPhase = 'checking' | 'anonymous' | 'authenticated';

export function BenzTechApp() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const merlinLogout = useMerlinLogout();
  const [session, setSession] = useState<TechnicianSession | null>(null);
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('checking');
  const [consentLoading, setConsentLoading] = useState(false);
  const [legalDisclaimerLoading, setLegalDisclaimerLoading] = useState(false);
  /** After password login, soft probe failures must not kick the tech to the login screen. */
  const holdAuthenticatedRef = useRef(false);

  const applySession = useCallback((next: TechnicianSession) => {
    setSession(next);
    setSessionPhase('authenticated');
    holdAuthenticatedRef.current = true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Cold start: one probe; timeout retries once before treating as anonymous.
    void (async () => {
      const first = await probeCurrentSession();
      if (cancelled) return;
      if (first.status === 'ok') {
        applySession(first.session);
        return;
      }
      if (first.status === 'timeout' || first.status === 'error') {
        clientLog.warn('auth.session_check_retry', { status: first.status });
        const second = await probeCurrentSession({ timeoutMs: 12_000 });
        if (cancelled) return;
        if (second.status === 'ok') {
          applySession(second.session);
          return;
        }
        // Still no cookie — show login (true cold / logged out)
        setSessionPhase('anonymous');
        return;
      }
      setSessionPhase('anonymous');
    })();

    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    if (sessionPhase === 'anonymous' && shouldUseClerkOnlyLogin()) {
      router.replace('/sign-in');
    }
  }, [sessionPhase, router]);

  const refreshSession = useCallback(
    async (options?: { clearOnMissing?: boolean }) => {
      const clearOnMissing = options?.clearOnMissing ?? !holdAuthenticatedRef.current;
      try {
        const result = await probeCurrentSession();
        if (result.status === 'ok') {
          applySession(result.session);
          return result.session;
        }
        if (result.status === 'timeout' || result.status === 'error') {
          clientLog.warn('auth.session_refresh_soft_fail', { status: result.status });
          // Keep authenticated shell when we already hold a password session.
          if (!clearOnMissing || holdAuthenticatedRef.current) {
            return session;
          }
        }
        if (clearOnMissing && !holdAuthenticatedRef.current) {
          setSession(null);
          setSessionPhase('anonymous');
        }
        return null;
      } catch (error: unknown) {
        clientLog.error('auth.session_refresh_failed', error);
        return holdAuthenticatedRef.current ? session : null;
      }
    },
    [applySession, session]
  );

  useEffect(() => {
    if (sessionPhase !== 'authenticated' || searchParams.get('link_account') !== '1') return;
    if (!isClerkSignInAvailable()) return;

    let cancelled = false;

    fetchClerkLinkStatus()
      .then(async (status) => {
        if (cancelled || !status.canLink) return;
        await linkClerkAccountSession();
        if (cancelled) return;
        toast.success('Clerk account linked');
        router.replace('/');
        await refreshSession({ clearOnMissing: false });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        clientLog.warn('auth.clerk_auto_link_skipped', error);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionPhase, searchParams, router, refreshSession]);

  const login = useCallback(
    async (d7Number: string, password: string) => {
      // Apply login body immediately (Apex pattern) — do not depend on a racing /me cookie read.
      const fromLogin = await loginWithCredentials(d7Number, password);
      if (fromLogin.status === 'success') {
        applySession(fromLogin.session);
        void refreshSession({ clearOnMissing: false });
      }
      return fromLogin;
    },
    [applySession, refreshSession]
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const result = await verifyMfaLogin(mfaToken, code);
      if (result.status !== 'success') {
        throw new Error('MFA verification incomplete');
      }
      applySession(result.session);
      void refreshSession({ clearOnMissing: false });
      return result.session;
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
      <LoadingScreen
        label="Checking session"
        sublabel="Verifying your dealership sign-in…"
      />
    );
  }

  if (sessionPhase !== 'authenticated' || !session) {
    if (shouldUseClerkOnlyLogin()) {
      return (
        <LoadingScreen
          label="Redirecting to sign-in"
          sublabel="Opening secure dealership authentication…"
        />
      );
    }
    return <LoginView onLogin={login} onMfaVerify={completeMfa} />;
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

  if (needsMfaEnrollment(session)) {
    return (
      <ForcedMfaEnrollScreen
        userName={session.name}
        onCompleted={async () => {
          const probed = await probeCurrentSession({ timeoutMs: 12_000 });
          if (probed.status === 'ok') {
            applySession(probed.session);
          } else {
            toast.error('MFA saved — please sign in again');
            await logout();
          }
        }}
        onLogout={logout}
      />
    );
  }

  if (needsConsent(session)) {
    return (
      <ConsentModal
        loading={consentLoading}
        onAccept={async () => {
          setConsentLoading(true);
          try {
            const accepted = await acceptConsentSession();
            setSession(accepted);
          } catch (error: unknown) {
            clientLog.error('compliance.consent_accept_failed', error);
            toast.error(error instanceof Error ? error.message : 'Could not save consent — try again');
          } finally {
            setConsentLoading(false);
          }
        }}
      />
    );
  }

  if (needsLegalDisclaimer(session)) {
    return (
      <LegalDisclaimerModal
        loading={legalDisclaimerLoading}
        onAccept={async () => {
          setLegalDisclaimerLoading(true);
          try {
            const accepted = await acceptLegalDisclaimerSession();
            cacheLegalDisclaimerLocally(accepted.technicianId);
            const latest = await refreshSession();
            setSession(latest ?? accepted);
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
    );
  }

  return (
    <BenzTechAuthenticatedApp
      session={session}
      onLogout={logout}
      onSessionRefresh={refreshSession}
    />
  );
}