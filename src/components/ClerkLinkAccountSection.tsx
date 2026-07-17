'use client';

import { Link2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, type ClerkLinkStatus } from '@/lib/api';
import { isClerkSignInAvailable } from '@/lib/authModeClient';

interface ClerkLinkAccountSectionProps {
  onLinked?: () => void;
}

export function ClerkLinkAccountSection({ onLinked }: ClerkLinkAccountSectionProps) {
  const [status, setStatus] = useState<ClerkLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const next = await api.getClerkLinkStatus();
      setStatus(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load Clerk link status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isClerkSignInAvailable()) {
      setLoading(false);
      return;
    }
    void refreshStatus();
  }, [refreshStatus]);

  if (!isClerkSignInAvailable()) return null;
  if (loading) {
    return (
      <div className="benz-card p-5 mb-5">
        <div className="text-sm text-benz-muted">Checking Clerk account status…</div>
      </div>
    );
  }

  if (!status?.clerkEnabled) return null;

  if (status.linked) {
    return (
      <div className="benz-card p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-2">
          <ShieldCheck size={18} className="text-benz-green" />
          <div className="font-semibold text-sm tracking-tight">Clerk Account Linked</div>
        </div>
        <p className="text-sm text-benz-secondary leading-relaxed">
          Your dealership account is linked to Clerk. You can sign in with either your D7 credentials
          or Clerk.
        </p>
      </div>
    );
  }

  const handleStartClerkSignIn = () => {
    window.location.href = '/sign-in?link_account=1';
  };

  const handleLinkAccount = async () => {
    setLinking(true);
    try {
      await api.linkClerkAccount();
      toast.success('Clerk account linked');
      await refreshStatus();
      onLinked?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not link Clerk account');
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="benz-card p-5 mb-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Link2 size={18} className="text-benz-blue" />
        <div className="font-semibold text-sm tracking-tight">Link Clerk Account</div>
      </div>
      <p className="text-sm text-benz-secondary leading-relaxed mb-4">
        Connect your existing D7 account to Clerk using the same dealership email address. After
        linking, you can sign in with either method.
      </p>

      {!status.clerkSignedIn ? (
        <button type="button" onClick={handleStartClerkSignIn} className="primary-btn w-full touch-target">
          Sign in with Clerk to link
        </button>
      ) : (
        <button
          type="button"
          onClick={handleLinkAccount}
          disabled={!status.canLink || linking}
          className="primary-btn w-full touch-target"
        >
          {linking ? 'Linking…' : status.canLink ? 'Link Clerk Account' : 'Email mismatch — contact your manager'}
        </button>
      )}
    </div>
  );
}