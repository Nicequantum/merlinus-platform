'use client';

import { useCallback, useState } from 'react';
import { generateTemporaryPassword } from '@/lib/passwordGenerator';
import { clientLog } from '@/lib/clientLog';
import { toast } from 'sonner';

type FormState = {
  dealerCode: string;
  confirmDealerCode: string;
  dealerName: string;
  rooftopName: string;
  managerName: string;
  managerEmail: string;
  managerD7: string;
};

const INITIAL: FormState = {
  dealerCode: '',
  confirmDealerCode: '',
  dealerName: '',
  rooftopName: '',
  managerName: '',
  managerEmail: '',
  managerD7: '',
};

type ProvisionSuccess = {
  created: boolean;
  skipped: boolean;
  dealerCode: string;
  rooftopName: string;
  dealershipId: string;
  temporaryPassword: string;
  managerD7: string;
  managerEmail: string;
};

/**
 * National-owner form to provision a new Mercedes-Benz rooftop via
 * POST /api/owner/provision-dealer (requires APEX_ALLOW_HTTP_PROVISION=true).
 */
export function OwnerOnboardDealershipForm({ onCompleted }: { onCompleted?: () => void }) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [success, setSuccess] = useState<ProvisionSuccess | null>(null);

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const errors: Partial<Record<keyof FormState, string>> = {};
    const code = form.dealerCode.trim().toUpperCase();
    if (code.length < 2 || code.length > 32) {
      errors.dealerCode = 'Use a short ops code (2–32 characters), e.g. NEWPORTMB.';
    }
    if (form.confirmDealerCode.trim().toUpperCase() !== code) {
      errors.confirmDealerCode = 'Must match the dealer code exactly (re-type to confirm).';
    }
    if (form.dealerName.trim().length < 3) {
      errors.dealerName = 'Enter the franchise / legal dealer name (at least 3 characters).';
    }
    if (form.rooftopName.trim().length < 5) {
      errors.rooftopName =
        'Enter the full storefront name shown in the app (at least 5 characters), e.g. Mercedes-Benz of Newport.';
    }
    if (form.managerName.trim().length < 2) {
      errors.managerName = 'Enter the service manager’s full name.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.managerEmail.trim())) {
      errors.managerEmail = 'Enter a valid work email for the manager login.';
    }
    const d7 = form.managerD7.trim().toUpperCase();
    if (d7.length < 5 || !/^D7[A-Z0-9]+$/i.test(d7)) {
      errors.managerD7 = 'Mercedes rooftops use a D7 number (e.g. D7HARRIH).';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form]);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      if (!validate()) {
        toast.error('Please fix the highlighted fields.');
        return;
      }

      setSubmitting(true);
      setSuccess(null);
      const temporaryPassword = generateTemporaryPassword(14);
      const dealerCode = form.dealerCode.trim().toUpperCase();
      const managerD7 = form.managerD7.trim().toUpperCase();
      const managerEmail = form.managerEmail.trim().toLowerCase();

      try {
        const res = await fetch('/api/owner/provision-dealer', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dealerCode,
            confirmDealerCode: form.confirmDealerCode.trim().toUpperCase(),
            dealerName: form.dealerName.trim(),
            rooftopName: form.rooftopName.trim(),
            templateId: 'mercedes-rooftop-v1',
            manager: {
              name: form.managerName.trim(),
              email: managerEmail,
              password: temporaryPassword,
              d7Number: managerD7,
              apexUsername: null,
            },
            ifExists: 'fail',
            dryRun: false,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          created?: boolean;
          skipped?: boolean;
          dealershipId?: string;
          rooftopName?: string;
          dealerCode?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || data.code || 'Could not create dealership');
        }

        setSuccess({
          created: Boolean(data.created),
          skipped: Boolean(data.skipped),
          dealerCode: data.dealerCode || dealerCode,
          rooftopName: data.rooftopName || form.rooftopName.trim(),
          dealershipId: data.dealershipId || '',
          temporaryPassword,
          managerD7,
          managerEmail,
        });
        setForm(INITIAL);
        toast.success(
          data.skipped
            ? 'Dealership already existed — no changes made.'
            : 'Dealership created. Share the temporary password securely.'
        );
        onCompleted?.();
      } catch (error: unknown) {
        clientLog.error('owner.onboard_provision_failed', error);
        toast.error(error instanceof Error ? error.message : 'Could not create dealership');
      } finally {
        setSubmitting(false);
      }
    },
    [form, onCompleted, submitting, validate]
  );

  return (
    <div className="apex-onboard">
      <div className="apex-onboard-help apex-card" role="region" aria-label="How onboarding works">
        <h3 className="apex-national-panel-title">How this works</h3>
        <ol className="apex-onboard-steps">
          <li>
            <strong>You create one rooftop</strong> with a franchise name, storefront name, and a
            service manager account.
          </li>
          <li>
            <strong>Mercedes template is applied automatically</strong> (D7 login + Xentry-ready
            story tools). No technical setup is required from you.
          </li>
          <li>
            <strong>The manager signs in with their D7 and temporary password</strong>, then must
            change the password on first use.
          </li>
          <li>
            <strong>Managers add their own technicians and advisors</strong> from inside that
            rooftop. Data stays isolated to this dealership.
          </li>
          <li>
            <strong>You enter the rooftop later</strong> from “View as / enter rooftop” if you need
            to support them — still audited as National Owner.
          </li>
        </ol>
        <p className="apex-hint">
          Tip: Dealer code is a short operations ID (letters/numbers). Rooftop name is what staff see
          in the app header (e.g. “Mercedes-Benz of Newport”).
        </p>
      </div>

      {success ? (
        <div className="apex-onboard-success apex-card apex-card-accent" role="status">
          <h3 className="apex-national-panel-title">Dealership ready</h3>
          <p className="apex-hint">
            <strong>{success.rooftopName}</strong> ({success.dealerCode})
            {success.created ? ' was created.' : success.skipped ? ' already existed.' : '.'}
          </p>
          <ul className="apex-onboard-cred-list">
            <li>
              Manager D7: <code>{success.managerD7}</code>
            </li>
            <li>
              Manager email: <code>{success.managerEmail}</code>
            </li>
            <li>
              Temporary password:{' '}
              <code className="apex-onboard-temp-pw">{success.temporaryPassword}</code>
            </li>
          </ul>
          <p className="apex-hint">
            Copy the temporary password now and send it through a secure channel. It will not be
            shown again. The manager must change it on first sign-in.
          </p>
          <button
            type="button"
            className="apex-btn-primary touch-target"
            onClick={() => {
              void navigator.clipboard
                ?.writeText(
                  `Rooftop: ${success.rooftopName}\nD7: ${success.managerD7}\nTemp password: ${success.temporaryPassword}`
                )
                .then(() => toast.success('Credentials copied'))
                .catch(() => toast.error('Could not copy — select and copy manually'));
            }}
          >
            Copy credentials
          </button>
          <button
            type="button"
            className="apex-btn-secondary touch-target"
            onClick={() => setSuccess(null)}
          >
            Onboard another dealership
          </button>
        </div>
      ) : (
        <form className="apex-onboard-form apex-card apex-card-accent" onSubmit={(e) => void onSubmit(e)}>
          <h3 className="apex-national-panel-title">Onboard New Dealership</h3>
          <p className="apex-hint">
            Creates an isolated Mercedes-Benz rooftop with one service manager. Required fields are
            marked.
          </p>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-dealer-code">
              Dealer code *
            </label>
            <input
              id="onboard-dealer-code"
              className="apex-input"
              autoComplete="off"
              value={form.dealerCode}
              onChange={(e) => setField('dealerCode', e.target.value.toUpperCase())}
              placeholder="NEWPORTMB"
              required
            />
            {fieldErrors.dealerCode ? (
              <p className="apex-field-error">{fieldErrors.dealerCode}</p>
            ) : (
              <p className="apex-hint">Short unique ops code (not the storefront name).</p>
            )}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-confirm-code">
              Confirm dealer code *
            </label>
            <input
              id="onboard-confirm-code"
              className="apex-input"
              autoComplete="off"
              value={form.confirmDealerCode}
              onChange={(e) => setField('confirmDealerCode', e.target.value.toUpperCase())}
              placeholder="Re-type dealer code"
              required
            />
            {fieldErrors.confirmDealerCode ? (
              <p className="apex-field-error">{fieldErrors.confirmDealerCode}</p>
            ) : null}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-dealer-name">
              Dealer / franchise name *
            </label>
            <input
              id="onboard-dealer-name"
              className="apex-input"
              value={form.dealerName}
              onChange={(e) => setField('dealerName', e.target.value)}
              placeholder="Newport Motors MB LLC"
              required
            />
            {fieldErrors.dealerName ? (
              <p className="apex-field-error">{fieldErrors.dealerName}</p>
            ) : (
              <p className="apex-hint">Legal or franchise label for this dealer group.</p>
            )}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-rooftop-name">
              Rooftop display name *
            </label>
            <input
              id="onboard-rooftop-name"
              className="apex-input"
              value={form.rooftopName}
              onChange={(e) => setField('rooftopName', e.target.value)}
              placeholder="Mercedes-Benz of Newport"
              required
            />
            {fieldErrors.rooftopName ? (
              <p className="apex-field-error">{fieldErrors.rooftopName}</p>
            ) : (
              <p className="apex-hint">Shown in the national list and dealership header.</p>
            )}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-mgr-name">
              Service manager name *
            </label>
            <input
              id="onboard-mgr-name"
              className="apex-input"
              value={form.managerName}
              onChange={(e) => setField('managerName', e.target.value)}
              placeholder="Alex Rivera"
              required
            />
            {fieldErrors.managerName ? (
              <p className="apex-field-error">{fieldErrors.managerName}</p>
            ) : null}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-mgr-email">
              Service manager email *
            </label>
            <input
              id="onboard-mgr-email"
              type="email"
              className="apex-input"
              value={form.managerEmail}
              onChange={(e) => setField('managerEmail', e.target.value)}
              placeholder="manager@dealership.com"
              required
            />
            {fieldErrors.managerEmail ? (
              <p className="apex-field-error">{fieldErrors.managerEmail}</p>
            ) : null}
          </div>

          <div className="apex-field">
            <label className="apex-label" htmlFor="onboard-mgr-d7">
              Service manager D7 *
            </label>
            <input
              id="onboard-mgr-d7"
              className="apex-input apex-input-mono"
              value={form.managerD7}
              onChange={(e) => setField('managerD7', e.target.value.toUpperCase())}
              placeholder="D7XXXXXX"
              required
            />
            {fieldErrors.managerD7 ? (
              <p className="apex-field-error">{fieldErrors.managerD7}</p>
            ) : (
              <p className="apex-hint">
                Mercedes sign-in ID. A temporary password is generated automatically and shown once
                after create.
              </p>
            )}
          </div>

          <button type="submit" className="apex-btn-primary touch-target w-full" disabled={submitting}>
            {submitting ? 'Creating dealership…' : 'Create dealership'}
          </button>
        </form>
      )}
    </div>
  );
}
