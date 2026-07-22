'use client';

import { useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/csrfClient';
import { isApexPlatformMode } from '@/lib/platformMode';

interface ForcedMfaEnrollScreenProps {
  userName?: string;
  onCompleted: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}

/**
 * Manager/owner MFA enrollment when MERLIN_MFA_ENFORCE requires it.
 * Uses /api/auth/mfa/setup + verify (TOTP) with QR + backup codes.
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
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

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
      qrCodeDataUrl?: string | null;
      message?: string;
      backupCodes?: string[];
    };
    if (!res.ok) {
      throw new Error(data.error || data.message || `Request failed (${res.status})`);
    }
    return data;
  }

  const startEnroll = async () => {
    setEnrolling(true);
    try {
      const data = await apiPost('/api/auth/mfa/setup', {});
      setSecret(data.secret || null);
      setOtpauthUrl(data.otpauthUrl || null);
      setQrCodeDataUrl(data.qrCodeDataUrl || null);
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
      const data = await apiPost('/api/auth/mfa/verify', { code: code.trim() });
      if (data.backupCodes?.length) {
        setBackupCodes(data.backupCodes);
        toast.success('MFA active — save your backup codes, then continue');
      } else {
        toast.success('Multi-factor authentication is active');
        await onCompleted();
      }
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

          {backupCodes ? (
            <div className="space-y-3">
              <p className="text-sm text-benz-secondary leading-relaxed">
                Save these one-time backup codes offline. You will need them if you lose your phone.
              </p>
              <ul className="grid grid-cols-2 gap-1.5 font-mono text-xs">
                {backupCodes.map((c) => (
                  <li key={c} className="bg-black/5 rounded px-2 py-1.5 text-center">
                    {c}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="primary-btn w-full touch-target"
                onClick={() => void onCompleted()}
              >
                I saved my codes — continue
              </button>
            </div>
          ) : !secret ? (
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
              {qrCodeDataUrl ? (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeDataUrl}
                    alt="Scan with authenticator app"
                    className="rounded-lg border border-benz-border bg-white p-2 w-[200px] h-[200px]"
                  />
                </div>
              ) : null}
              {otpauthUrl ? (
                <a
                  href={otpauthUrl}
                  className="secondary-btn w-full h-10 text-xs font-semibold flex items-center justify-center"
                >
                  Open in authenticator (mobile)
                </a>
              ) : null}
              <div className="text-xs text-benz-muted break-all font-mono bg-black/5 p-3 rounded-lg">
                <div className="font-semibold text-benz-secondary mb-1">Secret (manual entry)</div>
                {secret}
              </div>
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
