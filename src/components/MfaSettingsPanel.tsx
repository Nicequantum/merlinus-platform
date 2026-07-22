'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TechnicianSession } from '@/types';

interface MfaSettingsPanelProps {
  session: TechnicianSession;
  onSessionRefresh?: () => Promise<TechnicianSession | null>;
}

/**
 * Manager / owner MFA setup — QR + backup codes + regenerate.
 * Bay technicians can enroll optionally; elevated roles see enforcement notice.
 */
export function MfaSettingsPanel({ session, onSessionRefresh }: MfaSettingsPanelProps) {
  const elevated =
    session.role === 'manager' ||
    session.role === 'owner' ||
    session.isAdmin ||
    session.role === 'admin';

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<{
    mfaEnabled: boolean;
    mfaRequired: boolean;
    enforcementEnabled: boolean;
    backupCodesRemaining: number;
    enrolledAt: string | null;
  } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenCode, setRegenCode] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await api.mfaStatus();
      setStatus({
        mfaEnabled: s.mfaEnabled,
        mfaRequired: s.mfaRequired,
        enforcementEnabled: s.enforcementEnabled,
        backupCodesRemaining: s.backupCodesRemaining,
        enrolledAt: s.enrolledAt,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load MFA status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startSetup = async (rotate = false) => {
    setBusy(true);
    try {
      const data = await api.mfaSetup(rotate);
      setSecret(data.secret);
      setOtpauthUrl(data.otpauthUrl);
      setQrCodeDataUrl(data.qrCodeDataUrl || null);
      setBackupCodes(null);
      toast.success('Scan the QR code, then enter a 6-digit code');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start MFA setup');
    } finally {
      setBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api.mfaVerifyEnroll(code.trim());
      setBackupCodes(data.backupCodes || null);
      setSecret(null);
      setOtpauthUrl(null);
      setQrCodeDataUrl(null);
      setCode('');
      toast.success(data.message || 'MFA enabled — save your backup codes');
      if (data.requiresReauth) {
        toast.message('You will be signed out to apply MFA. Sign in again with your authenticator.');
      }
      await refresh();
      await onSessionRefresh?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await api.mfaRegenerateBackupCodes(regenCode.trim());
      setBackupCodes(data.backupCodes);
      setRegenCode('');
      toast.success('New backup codes issued');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not regenerate codes');
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Backup codes copied');
    } catch {
      toast.message('Select and copy the codes manually');
    }
  };

  return (
    <div className="benz-card p-5 mb-5">
      <div className="flex items-center gap-2.5 mb-3">
        <ShieldCheck size={18} className="text-benz-blue" />
        <div className="font-semibold text-sm tracking-tight">Multi-factor authentication</div>
      </div>

      {elevated ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 mb-4 text-xs text-amber-900 dark:text-amber-100 leading-relaxed">
          <strong>MFA recommended for managers.</strong>{' '}
          {status?.enforcementEnabled
            ? 'Enforcement is ON — enrollment is required before PII access.'
            : 'Enforcement is optional (pilot). Set MERLIN_MFA_ENFORCE=true when ready.'}
        </div>
      ) : (
        <p className="text-xs text-benz-secondary mb-4 leading-relaxed">
          Optional second factor. Bay technician login stays password-only unless you enable MFA.
        </p>
      )}

      {loading ? (
        <p className="text-xs text-benz-secondary">Loading MFA status…</p>
      ) : status?.mfaEnabled ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="status-pill status-pill-valid">MFA active</span>
            <span className="text-xs text-benz-secondary">
              {status.enrolledAt
                ? `Enrolled ${new Date(status.enrolledAt).toLocaleDateString()}`
                : 'Enrolled'}
              {` · ${status.backupCodesRemaining} backup codes left`}
            </span>
          </div>

          {backupCodes ? (
            <BackupCodesBlock codes={backupCodes} onCopy={() => void copyAll(backupCodes)} />
          ) : null}

          {elevated ? (
            <form onSubmit={(e) => void regenerate(e)} className="space-y-2 border-t border-benz-border/50 pt-4">
              <div className="text-xs font-semibold text-benz-secondary">Regenerate backup codes</div>
              <p className="text-[11px] text-benz-muted leading-relaxed">
                Requires a current authenticator code. Previous backup codes stop working.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  className="benz-input benz-input-mono flex-1"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  placeholder="6-digit code"
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
                <button
                  type="submit"
                  className="secondary-btn h-10 px-4 text-xs font-semibold flex items-center justify-center gap-1.5"
                  disabled={busy}
                >
                  <RefreshCw size={14} />
                  Issue new codes
                </button>
              </div>
            </form>
          ) : null}

          <button
            type="button"
            className="secondary-btn h-10 px-4 text-xs font-semibold"
            disabled={busy}
            onClick={() => void startSetup(true)}
          >
            Re-enroll authenticator
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!secret ? (
            <button
              type="button"
              className="primary-btn h-11 px-4 text-sm font-semibold"
              disabled={busy}
              onClick={() => void startSetup(false)}
            >
              {busy ? 'Preparing…' : 'Set up authenticator'}
            </button>
          ) : (
            <form onSubmit={(e) => void confirmSetup(e)} className="space-y-4">
              {qrCodeDataUrl ? (
                <div className="flex flex-col items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrCodeDataUrl}
                    alt="MFA QR code — scan with authenticator app"
                    className="rounded-lg border border-benz-border bg-white p-2 w-[220px] h-[220px]"
                  />
                  <p className="text-[11px] text-benz-muted text-center">
                    Scan with Google Authenticator, Authy, or 1Password
                  </p>
                </div>
              ) : null}
              {otpauthUrl ? (
                <a
                  href={otpauthUrl}
                  className="secondary-btn h-10 px-3 text-xs font-semibold inline-flex items-center justify-center w-full"
                >
                  Open in authenticator app (mobile)
                </a>
              ) : null}
              <div className="text-xs text-benz-muted break-all font-mono bg-black/5 p-3 rounded-lg">
                <div className="font-semibold text-benz-secondary mb-1">Manual secret</div>
                {secret}
              </div>
              <div>
                <label className="benz-label">6-digit code</label>
                <input
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
              <button type="submit" className="primary-btn w-full h-11" disabled={busy}>
                {busy ? 'Verifying…' : 'Enable MFA'}
              </button>
            </form>
          )}
        </div>
      )}

      {backupCodes && !status?.mfaEnabled ? (
        <div className="mt-4">
          <BackupCodesBlock codes={backupCodes} onCopy={() => void copyAll(backupCodes)} />
        </div>
      ) : null}
    </div>
  );
}

function BackupCodesBlock({ codes, onCopy }: { codes: string[]; onCopy: () => void }) {
  return (
    <div className="rounded-lg border border-benz-border/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold">Emergency backup codes</div>
        <button
          type="button"
          className="secondary-btn h-8 px-2 text-[11px] font-semibold flex items-center gap-1"
          onClick={onCopy}
        >
          <Copy size={12} /> Copy all
        </button>
      </div>
      <p className="text-[11px] text-benz-muted leading-relaxed">
        Store offline. Each code works once. Shown only now — save them before leaving this page.
      </p>
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-xs">
        {codes.map((c) => (
          <li key={c} className="bg-black/5 rounded px-2 py-1.5 text-center">
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}
