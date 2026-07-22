'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { DealershipBranding } from '@/components/DealershipBranding';
import { isClerkSignInAvailable } from '@/lib/authModeClient';
import type { MerlinLoginResult } from '@/lib/loginSession';
import type { TechnicianSession } from '@/types';
import { toast } from 'sonner';

interface LoginViewProps {
  /** Password stage — may return mfa_required without a session. */
  onLogin: (d7Number: string, password: string) => Promise<MerlinLoginResult>;
  /** MFA stage after password (TOTP or backup code). */
  onMfaVerify: (mfaToken: string, code: string) => Promise<TechnicianSession>;
}

/**
 * Self-service recovery UI is always shown; the API returns 403 when
 * MERLIN_PASSWORD_RECOVERY_ENABLED is off (P3-4).
 * MFA: password → optional TOTP/backup challenge for enrolled elevated accounts.
 */
export function LoginView({ onLogin, onMfaVerify }: LoginViewProps) {
  const { t } = useTranslation('auth');
  const [d7Number, setD7Number] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [recoveryStep, setRecoveryStep] = useState<'request' | 'confirm'>('request');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaName, setMfaName] = useState<string | undefined>();
  const showClerkOption = isClerkSignInAvailable();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await onLogin(d7Number.trim().toUpperCase(), password);
      if (result.status === 'mfa_required') {
        setMfaToken(result.mfaToken);
        setMfaName(result.name);
        toast.message('Authenticator code required');
        return;
      }
      toast.success(t('signedIn'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    try {
      await onMfaVerify(mfaToken, mfaCode.trim());
      toast.success(t('signedIn'));
      setMfaToken(null);
      setMfaCode('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid authentication code');
    } finally {
      setLoading(false);
    }
  };

  const requestRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryLoading(true);
    try {
      const res = await fetch('/api/auth/password-recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          d7Number: d7Number.trim().toUpperCase(),
          email: recoveryEmail.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        recoveryToken?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Recovery is not available');
      }
      toast.message(
        data.message ||
          'If your account matches, continue with the token from your manager or email.'
      );
      if (data.recoveryToken) {
        setRecoveryToken(data.recoveryToken);
        setRecoveryStep('confirm');
        toast.success('Staging token issued — set a new password below');
      } else {
        setRecoveryStep('confirm');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start recovery');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const confirmRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryLoading(true);
    try {
      const res = await fetch('/api/auth/password-recovery/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          token: recoveryToken.trim(),
          newPassword,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.error || data.message || 'Could not reset password');
      }
      toast.success(data.message || 'Password updated — sign in');
      setShowRecovery(false);
      setRecoveryStep('request');
      setRecoveryToken('');
      setNewPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setRecoveryLoading(false);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-panel">
        <div className="merlin-brand-hero login-brand">
          <ApexLogoMark size="lg" animated title="Apex" />
          <p className="merlin-wordmark">
            Apex
            <span className="merlin-wordmark-accent">National Platform</span>
          </p>
          <div className="merlin-brand-divider" aria-hidden="true" />
          <DealershipBranding size="lg" />
        </div>

        {mfaToken ? (
          <form
            onSubmit={(e) => void handleMfaSubmit(e)}
            className="login-form benz-card-elevated benz-card-elevated-accent"
          >
            <h2 className="text-lg font-semibold tracking-tight mb-1">Authenticator code</h2>
            <p className="text-sm text-benz-secondary mb-4 leading-relaxed">
              {mfaName ? `${mfaName}, enter` : 'Enter'} the 6-digit code from your app, or a backup
              code.
            </p>
            <div className="login-field">
              <label className="benz-label">Code</label>
              <input
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.toUpperCase().slice(0, 20))}
                placeholder="123456 or XXXX-XXXX"
                required
                className="benz-input benz-input-mono"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="primary-btn login-submit-btn w-full touch-target"
            >
              {loading ? 'Verifying…' : 'Verify and sign in'}
            </button>
            <button
              type="button"
              className="text-sm text-benz-secondary underline w-full mt-3 touch-target"
              onClick={() => {
                setMfaToken(null);
                setMfaCode('');
                setPassword('');
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : !showRecovery ? (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="login-form benz-card-elevated benz-card-elevated-accent"
          >
            <div className="login-field">
              <label className="benz-label">{t('d7Label')}</label>
              <input
                type="text"
                value={d7Number}
                onChange={(e) => setD7Number(e.target.value.toUpperCase())}
                placeholder="D7HARRIH"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                required
                className="benz-input benz-input-mono uppercase"
              />
            </div>
            <div className="login-field">
              <label className="benz-label">{t('password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="benz-input"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="primary-btn login-submit-btn w-full touch-target"
            >
              {loading ? t('signingIn') : t('signIn')}
            </button>

            <button
              type="button"
              className="text-sm text-benz-secondary underline w-full mt-3 touch-target"
              onClick={() => setShowRecovery(true)}
            >
              Forgot password?
            </button>

            {showClerkOption ? (
              <div className="login-alt-auth">
                <div className="login-alt-divider" aria-hidden="true">
                  <span>{t('or')}</span>
                </div>
                <Link href="/sign-in" className="secondary-btn login-clerk-btn w-full touch-target">
                  Sign in with Clerk
                </Link>
              </div>
            ) : null}
          </form>
        ) : (
          <div className="login-form benz-card-elevated benz-card-elevated-accent space-y-4 p-6">
            <h2 className="text-lg font-semibold">Reset password</h2>
            <p className="text-sm text-benz-secondary">
              Enter your D7 and work email. If recovery is enabled for this dealership, you can set a
              new password with a one-time token.
            </p>
            {recoveryStep === 'request' ? (
              <form onSubmit={(e) => void requestRecovery(e)} className="space-y-3">
                <div className="login-field">
                  <label className="benz-label">D7 number</label>
                  <input
                    className="benz-input benz-input-mono uppercase"
                    value={d7Number}
                    onChange={(e) => setD7Number(e.target.value.toUpperCase())}
                    required
                  />
                </div>
                <div className="login-field">
                  <label className="benz-label">Work email</label>
                  <input
                    type="email"
                    className="benz-input"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    required
                  />
                </div>
                <button type="submit" className="primary-btn w-full" disabled={recoveryLoading}>
                  {recoveryLoading ? 'Submitting…' : 'Request reset'}
                </button>
              </form>
            ) : (
              <form onSubmit={(e) => void confirmRecovery(e)} className="space-y-3">
                <div className="login-field">
                  <label className="benz-label">Recovery token</label>
                  <input
                    className="benz-input font-mono text-sm"
                    value={recoveryToken}
                    onChange={(e) => setRecoveryToken(e.target.value)}
                    required
                  />
                </div>
                <div className="login-field">
                  <label className="benz-label">New password</label>
                  <input
                    type="password"
                    className="benz-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                <button type="submit" className="primary-btn w-full" disabled={recoveryLoading}>
                  {recoveryLoading ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            )}
            <button
              type="button"
              className="text-sm text-benz-secondary underline w-full"
              onClick={() => {
                setShowRecovery(false);
                setRecoveryStep('request');
              }}
            >
              Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
