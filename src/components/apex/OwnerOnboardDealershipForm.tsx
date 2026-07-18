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
  /** Optional — dealership owner (email login + group membership). */
  ownerName: string;
  ownerEmail: string;
};

const INITIAL: FormState = {
  dealerCode: '',
  confirmDealerCode: '',
  dealerName: '',
  rooftopName: '',
  managerName: '',
  managerEmail: '',
  managerD7: '',
  ownerName: '',
  ownerEmail: '',
};

type ProvisionSuccess = {
  created: boolean;
  skipped: boolean;
  dealerCode: string;
  rooftopName: string;
  dealershipId: string;
  managerTemporaryPassword: string;
  managerD7: string;
  managerEmail: string;
  /** Present when owner fields were submitted. */
  ownerEmail: string | null;
  ownerName: string | null;
  ownerTemporaryPassword: string | null;
  ownerCreated: boolean;
  ownerLinked: boolean;
};

/**
 * National-owner form to provision a new Mercedes-Benz rooftop via
 * POST /api/owner/provision-dealer (requires APEX_ALLOW_HTTP_PROVISION=true).
 *
 * Service manager (D7) is always required. Optional owner name/email creates or
 * links an owner-level membership so the dealership owner gets dashboard access
 * without waiting for the manager to set them up later.
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

    const ownerName = form.ownerName.trim();
    const ownerEmail = form.ownerEmail.trim();
    const ownerPartial = Boolean(ownerName || ownerEmail);
    if (ownerPartial) {
      if (ownerName.length < 2) {
        errors.ownerName = 'Enter the dealership owner’s full name, or clear both owner fields.';
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
        errors.ownerEmail = 'Enter a valid owner email, or clear both owner fields.';
      } else if (ownerEmail.toLowerCase() === form.managerEmail.trim().toLowerCase()) {
        errors.ownerEmail = 'Owner email must be different from the service manager email.';
      }
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
      const managerTemporaryPassword = generateTemporaryPassword(14);
      const dealerCode = form.dealerCode.trim().toUpperCase();
      const managerD7 = form.managerD7.trim().toUpperCase();
      const managerEmail = form.managerEmail.trim().toLowerCase();
      const ownerName = form.ownerName.trim();
      const ownerEmailRaw = form.ownerEmail.trim().toLowerCase();
      const includeOwner = Boolean(ownerName && ownerEmailRaw);
      const ownerTemporaryPassword = includeOwner ? generateTemporaryPassword(14) : null;

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
              password: managerTemporaryPassword,
              d7Number: managerD7,
              apexUsername: null,
            },
            ...(includeOwner && ownerTemporaryPassword
              ? {
                  owner: {
                    name: ownerName,
                    email: ownerEmailRaw,
                    password: ownerTemporaryPassword,
                  },
                }
              : {}),
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
          ownerCreated?: boolean;
          ownerLinked?: boolean;
          ownerId?: string | null;
        };

        if (!res.ok) {
          throw new Error(data.error || data.code || 'Could not create dealership');
        }

        const ownerCreated = Boolean(data.ownerCreated);
        const ownerLinked = Boolean(data.ownerLinked);
        setSuccess({
          created: Boolean(data.created),
          skipped: Boolean(data.skipped),
          dealerCode: data.dealerCode || dealerCode,
          rooftopName: data.rooftopName || form.rooftopName.trim(),
          dealershipId: data.dealershipId || '',
          managerTemporaryPassword,
          managerD7,
          managerEmail,
          ownerEmail: includeOwner ? ownerEmailRaw : null,
          ownerName: includeOwner ? ownerName : null,
          // Only show a temp password when a new owner account was created.
          ownerTemporaryPassword: includeOwner && ownerCreated ? ownerTemporaryPassword : null,
          ownerCreated,
          ownerLinked,
        });
        setForm(INITIAL);
        toast.success(
          data.skipped
            ? 'Dealership already existed — no changes made.'
            : includeOwner
              ? 'Dealership created with manager and owner access. Share credentials securely.'
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
            service manager account (D7 login).
          </li>
          <li>
            <strong>Optionally add the dealership owner</strong> with name and email so they get
            their own owner dashboard access immediately — without the manager setting them up
            later.
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
            <strong>The owner (if created) signs in with email and temporary password</strong> and
            can enter this rooftop from their owner console.
          </li>
          <li>
            <strong>Managers add their own technicians and advisors</strong> from inside that
            rooftop. Data stays isolated to this dealership.
          </li>
        </ol>
        <p className="apex-hint">
          Tip: Dealer code is a short operations ID (letters/numbers). Rooftop name is what staff see
          in the app header (e.g. “Mercedes-Benz of Newport”). Owner fields are optional — leave
          blank if you only need the service manager for now.
        </p>
      </div>

      {success ? (
        <div className="apex-onboard-success apex-card apex-card-accent" role="status">
          <h3 className="apex-national-panel-title">Dealership ready</h3>
          <p className="apex-hint">
            <strong>{success.rooftopName}</strong> ({success.dealerCode})
            {success.created ? ' was created.' : success.skipped ? ' already existed.' : '.'}
          </p>
          <h4 className="apex-onboard-cred-heading">Service manager (D7 — primary rooftop login)</h4>
          <ul className="apex-onboard-cred-list">
            <li>
              Manager D7: <code>{success.managerD7}</code>
            </li>
            <li>
              Manager email: <code>{success.managerEmail}</code>
            </li>
            <li>
              Temporary password:{' '}
              <code className="apex-onboard-temp-pw">{success.managerTemporaryPassword}</code>
            </li>
          </ul>
          {success.ownerEmail ? (
            <>
              <h4 className="apex-onboard-cred-heading">Dealership owner (email login)</h4>
              <ul className="apex-onboard-cred-list">
                {success.ownerName ? (
                  <li>
                    Owner name: <code>{success.ownerName}</code>
                  </li>
                ) : null}
                <li>
                  Owner email: <code>{success.ownerEmail}</code>
                </li>
                {success.ownerLinked ? (
                  <li>
                    Linked existing owner account — they already have credentials; no new temporary
                    password was set.
                  </li>
                ) : success.ownerTemporaryPassword ? (
                  <li>
                    Temporary password:{' '}
                    <code className="apex-onboard-temp-pw">{success.ownerTemporaryPassword}</code>
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
          <p className="apex-hint">
            Copy temporary password(s) now and send through a secure channel. They will not be
            shown again. New accounts must change password on first sign-in.
          </p>
          <button
            type="button"
            className="apex-btn-primary touch-target"
            onClick={() => {
              const lines = [
                `Rooftop: ${success.rooftopName}`,
                `Manager D7: ${success.managerD7}`,
                `Manager temp password: ${success.managerTemporaryPassword}`,
              ];
              if (success.ownerEmail) {
                lines.push(`Owner email: ${success.ownerEmail}`);
                if (success.ownerLinked) {
                  lines.push('Owner: linked existing account (no new password)');
                } else if (success.ownerTemporaryPassword) {
                  lines.push(`Owner temp password: ${success.ownerTemporaryPassword}`);
                }
              }
              void navigator.clipboard
                ?.writeText(lines.join('\n'))
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
            Creates an isolated Mercedes-Benz rooftop with one service manager. Optionally grant the
            dealership owner dashboard access at the same time. Required fields are marked.
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

          <fieldset className="apex-onboard-fieldset">
            <legend className="apex-onboard-legend">Service manager (required)</legend>
            <p className="apex-hint">
              Primary rooftop login via D7. Temporary password is generated and shown once after
              create.
            </p>

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
                <p className="apex-hint">Mercedes sign-in ID for day-to-day rooftop operations.</p>
              )}
            </div>
          </fieldset>

          <fieldset className="apex-onboard-fieldset">
            <legend className="apex-onboard-legend">Dealership owner (optional)</legend>
            <p className="apex-hint">
              Give the actual owner immediate owner-console access for this rooftop. Leave blank to
              onboard manager-only and add the owner later.
            </p>

            <div className="apex-field">
              <label className="apex-label" htmlFor="onboard-owner-name">
                Owner name
              </label>
              <input
                id="onboard-owner-name"
                className="apex-input"
                value={form.ownerName}
                onChange={(e) => setField('ownerName', e.target.value)}
                placeholder="Jordan Lee"
                autoComplete="off"
              />
              {fieldErrors.ownerName ? (
                <p className="apex-field-error">{fieldErrors.ownerName}</p>
              ) : null}
            </div>

            <div className="apex-field">
              <label className="apex-label" htmlFor="onboard-owner-email">
                Owner email
              </label>
              <input
                id="onboard-owner-email"
                type="email"
                className="apex-input"
                value={form.ownerEmail}
                onChange={(e) => setField('ownerEmail', e.target.value)}
                placeholder="owner@dealership.com"
                autoComplete="off"
              />
              {fieldErrors.ownerEmail ? (
                <p className="apex-field-error">{fieldErrors.ownerEmail}</p>
              ) : (
                <p className="apex-hint">
                  Email login (not D7). If this owner already exists, they are linked to the new
                  rooftop without resetting their password.
                </p>
              )}
            </div>
          </fieldset>

          <button type="submit" className="apex-btn-primary touch-target w-full" disabled={submitting}>
            {submitting ? 'Creating dealership…' : 'Create dealership'}
          </button>
        </form>
      )}
    </div>
  );
}
