'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingScreen } from '@/components/LoadingScreen';
import { LoginView } from '@/components/LoginView';
import { ManagerJobsMonitor } from '@/components/ManagerJobsMonitor';
import { api, ApiError } from '@/lib/api';
import { effectiveRole } from '@/lib/apex/viewAs';
import type { TechnicianSession } from '@/types';

/**
 * Standalone Manager Job Monitor — /manager/jobs
 * Same surface as in-app AppView "jobs" for deep-links / bookmarks.
 */
export default function ManagerJobsPage() {
  const router = useRouter();
  const [session, setSession] = useState<TechnicianSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { session: current } = await api.me();
        if (cancelled) return;
        if (!current) {
          setSession(null);
          return;
        }
        const role = effectiveRole(current);
        if (role !== 'manager' && !current.isAdmin && role !== 'owner') {
          setDenied(true);
          router.replace('/');
          return;
        }
        setSession(current);
      } catch (error) {
        if (!cancelled) {
          if (error instanceof ApiError && error.status === 401) {
            setSession(null);
          } else {
            setDenied(true);
            router.replace('/');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading || denied) {
    return <LoadingScreen label="Checking access" sublabel="Verifying manager permissions…" />;
  }

  if (!session) {
    return (
      <LoginView
        onLogin={async (d7Number, password) => {
          const data = await api.login(d7Number, password);
          if (data.requiresMfa && data.mfaToken) {
            return {
              status: 'mfa_required' as const,
              mfaToken: data.mfaToken,
              technicianId: data.technicianId || '',
              name: data.name,
            };
          }
          if (!data.session) {
            throw new ApiError('Login failed', 401);
          }
          const role = effectiveRole(data.session);
          if (role !== 'manager' && !data.session.isAdmin && role !== 'owner') {
            router.replace('/');
            throw new ApiError('Manager access required.', 403);
          }
          setSession(data.session);
          return { status: 'success' as const, session: data.session };
        }}
        onMfaVerify={async (mfaToken, code) => {
          const data = await api.verifyMfaLogin(mfaToken, code);
          if (!data.session) throw new ApiError('MFA verification failed', 401);
          const role = effectiveRole(data.session);
          if (role !== 'manager' && !data.session.isAdmin && role !== 'owner') {
            router.replace('/');
            throw new ApiError('Manager access required.', 403);
          }
          setSession(data.session);
          return data.session;
        }}
      />
    );
  }

  return (
    <main className="min-h-screen">
      <ManagerJobsMonitor
        session={session}
        onOpenSettings={() => router.push('/')}
        onLogout={async () => {
          try {
            await api.logout();
          } catch {
            // ignore
          }
          router.replace('/');
        }}
        onBack={() => router.push('/')}
      />
    </main>
  );
}
