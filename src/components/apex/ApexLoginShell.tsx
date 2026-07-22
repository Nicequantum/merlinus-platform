'use client';

import { useState } from 'react';
import { ApexDealershipSelector } from '@/components/apex/ApexDealershipSelector';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import type { ApexLoginDealershipOption } from '@/lib/apexLoginSession';
import { toast } from 'sonner';

export type ApexLoginShellResult =
  | { status: 'success' }
  | { status: 'select_dealership'; pendingToken: string; dealerships: ApexLoginDealershipOption[] }
  | { status: 'mfa_required'; mfaToken: string; name?: string };

interface ApexLoginShellProps {
  onLogin: (identifier: string, password: string) => Promise<ApexLoginShellResult>;
  onMfaVerify: (
    mfaToken: string,
    code: string
  ) => Promise<ApexLoginShellResult>;
  onSelectDealership: (
    pendingToken: string,
    dealershipId: string,
    rememberAsDefault?: boolean
  ) => Promise<void>;
}

type LoginStep = 'credentials' | 'mfa' | 'dealership';

export function ApexLoginShell({
  onLogin,
  onMfaVerify,
  onSelectDealership,
}: ApexLoginShellProps) {
  const [step, setStep] = useState<LoginStep>('credentials');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [dealerships, setDealerships] = useState<ApexLoginDealershipOption[]>([]);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaName, setMfaName] = useState<string | undefined>();

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await onLogin(identifier.trim(), password);
      if (result.status === 'mfa_required') {
        setMfaToken(result.mfaToken);
        setMfaName(result.name);
        setStep('mfa');
        toast.message('Authenticator code required');
        return;
      }
      if (result.status === 'select_dealership') {
        setPendingToken(result.pendingToken);
        setDealerships(result.dealerships);
        setStep('dealership');
        return;
      }
      toast.success('Signed in');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;
    setLoading(true);
    try {
      const result = await onMfaVerify(mfaToken, mfaCode.trim());
      if (result.status === 'select_dealership') {
        setPendingToken(result.pendingToken);
        setDealerships(result.dealerships);
        setStep('dealership');
        setMfaToken(null);
        setMfaCode('');
        return;
      }
      if (result.status === 'mfa_required') {
        toast.error('MFA challenge still open — try again');
        return;
      }
      toast.success('Signed in');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid authentication code');
    } finally {
      setLoading(false);
    }
  };

  const handleDealershipSelect = async (
    dealershipId: string,
    options: { rememberAsDefault: boolean }
  ) => {
    if (!pendingToken) return;
    setLoading(true);
    try {
      await onSelectDealership(pendingToken, dealershipId, options.rememberAsDefault);
      toast.success('Dealership selected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not select dealership');
    } finally {
      setLoading(false);
    }
  };

  const resetToCredentials = () => {
    setStep('credentials');
    setPendingToken(null);
    setDealerships([]);
    setPassword('');
    setMfaToken(null);
    setMfaCode('');
  };

  const title =
    step === 'credentials'
      ? 'Sign in to Apex'
      : step === 'mfa'
        ? 'Multi-factor authentication'
        : 'Select rooftop';

  const lead =
    step === 'credentials'
      ? 'Owners use email. Technicians use D7 number or Apex username.'
      : step === 'mfa'
        ? 'Managers and owners with MFA enabled must confirm with an authenticator code.'
        : 'Choose the dealership workspace for this session.';

  return (
    <div className="apex-login-shell" data-platform="apex">
      <div className="apex-ambient" aria-hidden="true">
        <div className="apex-ambient-grid" />
        <div className="apex-ambient-logo-wash" />
        <div className="apex-ambient-gauge apex-ambient-gauge--left" />
        <div className="apex-ambient-gauge apex-ambient-gauge--right" />
        <div className="apex-ambient-circuit" />
      </div>

      <div className="apex-login-layout">
        <aside className="apex-login-aside">
          <div className="apex-brand-hero apex-brand-hero--login">
            <ApexLogoMark size="xl" animated />
            <p className="apex-wordmark">
              Apex
              <span className="apex-wordmark-accent">National Platform</span>
            </p>
            <div className="apex-brand-divider" aria-hidden="true" />
            <p className="apex-brand-tagline">
              Unified national operations and multi-rooftop dealership access —
              engineered for precision, security, and scale.
            </p>
          </div>
          <ul className="apex-login-highlights">
            <li>
              <span className="apex-login-highlight-dot" aria-hidden="true" />
              National command center for aggregate metrics
            </li>
            <li>
              <span className="apex-login-highlight-dot" aria-hidden="true" />
              Least-privilege enter/exit dealership PII scope
            </li>
            <li>
              <span className="apex-login-highlight-dot" aria-hidden="true" />
              Full session fortress and fail-closed auditing
            </li>
          </ul>
        </aside>

        <div className="apex-login-panel">
          <div className="apex-login-panel-header">
            <p className="apex-login-kicker">Secure access</p>
            <h1 className="apex-login-title">{title}</h1>
            <p className="apex-login-lead">{lead}</p>
          </div>

          {step === 'credentials' ? (
            <form
              onSubmit={(e) => void handleCredentialsSubmit(e)}
              className="apex-login-form apex-card apex-card-accent"
            >
              <div className="apex-field">
                <label className="apex-label" htmlFor="apex-identifier">
                  Email, D7, or Username
                </label>
                <input
                  id="apex-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="owner@company.com · D7HARRIH · brand.name"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="username"
                  required
                  className="apex-input"
                />
                <p className="apex-hint">
                  National owners sign in with email and land in national scope (no PII until enter
                  dealership).
                </p>
              </div>
              <div className="apex-field">
                <label className="apex-label" htmlFor="apex-password">
                  Password
                </label>
                <input
                  id="apex-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  className="apex-input"
                />
              </div>
              <button type="submit" disabled={loading} className="apex-btn-primary w-full touch-target">
                {loading ? 'Authenticating…' : 'Sign in'}
              </button>
            </form>
          ) : step === 'mfa' ? (
            <form
              onSubmit={(e) => void handleMfaSubmit(e)}
              className="apex-login-form apex-card apex-card-accent"
            >
              <div className="apex-field">
                <label className="apex-label" htmlFor="apex-mfa-code">
                  Authenticator or backup code
                </label>
                <input
                  id="apex-mfa-code"
                  type="text"
                  inputMode="text"
                  autoComplete="one-time-code"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.toUpperCase().slice(0, 20))}
                  placeholder="123456 or XXXX-XXXX"
                  required
                  autoFocus
                  className="apex-input"
                />
                <p className="apex-hint">
                  {mfaName ? `${mfaName}: ` : ''}
                  Open your authenticator app for a 6-digit code, or use a one-time backup code.
                </p>
              </div>
              <button type="submit" disabled={loading} className="apex-btn-primary w-full touch-target">
                {loading ? 'Verifying…' : 'Verify and continue'}
              </button>
              <button
                type="button"
                className="text-sm text-benz-secondary underline w-full mt-3 touch-target"
                onClick={resetToCredentials}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <div className="apex-login-form apex-card apex-card-accent">
              <ApexDealershipSelector
                dealerships={dealerships}
                loading={loading}
                showRememberDefault
                onSelect={handleDealershipSelect}
                onBack={resetToCredentials}
                backLabel="Back to sign in"
              />
            </div>
          )}

          <p className="apex-login-footer">Authorized personnel only · All access is audited.</p>
        </div>
      </div>
    </div>
  );
}
