'use client';

import { useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/csrf';
import { isApexPlatformMode } from '@/lib/platformMode';

interface ForcedMfaEnrollScreenProps {
  userName?: string;
  onCompleted: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}

/**
 * P1-3 — Manager/owner MFA enrollment when MERLIN_MFA_ENFORCE requires it.
 * Uses /api/auth/mfa/enroll + verify (TOTP).
 */
export function ForcedMfaEnrollScreen({
  userName,
  onCompleted,
  onLogout,
}: ForcedMfaEnrollScreenProps) {
  const apex = isApexPlatformMode();
  const formId = useId();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  async function apiPost(path: string, body: unknown) {
    const csrf = readCsrfTokenFromDocument();
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(csrf ? { [CSRF_HEADER]: csrf } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      secret?: string;
      otpauthUrl?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data;
  }

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const data = await apiPost('/api/auth/mfa/enroll', {});
      setSecret(data.secret || null);
      setOtpauthUrl(data.otpauthUrl || null);
      toast.success('Authenticator secret ready — scan and enter a code');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start MFA enrollment');
    } finally {
      setEnrolling(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 6) {
      toast.error('Enter the 6-digit code from your authenticator app');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/api/auth/mfa/verify', { code: code.trim() });
      toast.success('Multi-factor authentication is active');
      await onCompleted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel max-w-md">
        <div className="merlin-brand-hero login-brand">
          {apex ? <ApexLogoMark size="lg" animated title="Apex" /> : null}
          <p className="merlin-wordmark">
            {apex ? 'Apex' : 'Merlinus'}
            <span className="merlin-wordmark-accent">Security check</span>
          </p>
        </div>

        <div className="benz-card-elevated benz-card-elevated-accent p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="shrink-0 text-benz-accent" size={28} aria-hidden />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">
                Set up multi-factor authentication
              </h1>
              <p className="text-sm text-benz-secondary mt-1 leading-relaxed">
                {userName ? `${userName}, your` : 'Your'} role requires an authenticator app before
                accessing dealership data.
              </p>
            </div>
          </div>

          {!secret ? (
            <button
              type="button"
              className="primary-btn w-full touch-target"
              disabled={enrolling}
              onClick={() => void startEnroll()}
            >
              {enrolling ? 'Preparing…' : 'Generate authenticator key'}
            </button>
          ) : (
            <form id={formId} onSubmit={(e) => void verify(e)} className="space-y-4">
              <div className="text-xs text-benz-muted break-all font-mono bg-black/5 p-3 rounded-lg">
                <div className="font-semibold text-benz-secondary mb-1">Secret (manual entry)</div>
                {secret}
              </div>
              {otpauthUrl ? (
                <p className="text-xs text-benz-muted break-all">
                  otpauth URI (for advanced scanners):{' '}
                  <span className="font-mono">{otpauthUrl}</span>
                </p>
              ) : null}
              <div>
                <label className="benz-label" htmlFor={`${formId}-code`}>
                  6-digit code
                </label>
                <input
                  id={`${formId}-code`}
                  className="benz-input benz-input-mono w-full"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                />
              </div>
              <button type="submit" className="primary-btn w-full touch-target" disabled={loading}>
                {loading ? 'Verifying…' : 'Confirm and continue'}
              </button>
            </form>
          )}

          <button
            type="button"
            className="text-sm text-benz-secondary underline w-full touch-target"
            onClick={() => void onLogout()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
