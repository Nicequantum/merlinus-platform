'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingScreen } from '@/components/LoadingScreen';
import { LoginView } from '@/components/LoginView';
import { UsageDashboardView } from '@/components/UsageDashboardView';
import { api, ApiError } from '@/lib/api';
import type { TechnicianSession } from '@/types';

export default function AdminUsagePage() {
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
        if (!current.isAdmin) {
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

    load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading || denied) {
    return <LoadingScreen label="Checking access" sublabel="Verifying admin permissions..." />;
  }

  if (!session) {
    return (
      <LoginView
        onLogin={async (d7Number, password) => {
          const { session: loggedIn } = await api.login(d7Number, password);
          if (!loggedIn.isAdmin) {
            router.replace('/');
            throw new ApiError('Admin access required.', 403);
          }
          setSession(loggedIn);
          return loggedIn;
        }}
      />
    );
  }

  return <UsageDashboardView dealershipName={session.dealershipName} />;
}