'use client';

import { useCallback, useEffect, useState } from 'react';
import { clientLog } from '@/lib/clientLog';
import { toast } from 'sonner';

type Severity = 'pass' | 'warn' | 'fail' | 'info';

type CheckItem = {
  id: string;
  title: string;
  status: Severity;
  blocksProvision: boolean;
  detail: string;
  action?: string;
};

type PlatformReadiness = {
  evaluatedAt: string;
  canProvision: boolean;
  overall: 'ready' | 'ready_with_warnings' | 'blocked';
  summary: string;
  checks: CheckItem[];
  afterProvisionSteps: Array<{ id: string; title: string; detail: string }>;
  ciNote: string;
};

type RooftopReadiness = {
  dealershipId: string;
  rooftopName: string;
  evaluatedAt: string;
  overall: 'ready' | 'ready_with_warnings' | 'blocked';
  checks: CheckItem[];
};

function statusClass(status: Severity): string {
  switch (status) {
    case 'pass':
      return 'apex-readiness-badge apex-readiness-badge--pass';
    case 'warn':
      return 'apex-readiness-badge apex-readiness-badge--warn';
    case 'fail':
      return 'apex-readiness-badge apex-readiness-badge--fail';
    default:
      return 'apex-readiness-badge apex-readiness-badge--info';
  }
}

function overallClass(overall: string): string {
  if (overall === 'ready') return 'apex-readiness-overall apex-readiness-overall--ready';
  if (overall === 'ready_with_warnings') return 'apex-readiness-overall apex-readiness-overall--warn';
  return 'apex-readiness-overall apex-readiness-overall--blocked';
}

/**
 * National-owner pilot readiness — runs live platform checks in-app
 * (Worker-side equivalent of P0 verify) before / after onboard.
 */
export function OwnerPilotReadinessPanel({
  mode,
  dealershipId,
  autoRun = true,
  onCanProvisionChange,
}: {
  mode: 'platform' | 'rooftop';
  dealershipId?: string | null;
  autoRun?: boolean;
  onCanProvisionChange?: (can: boolean, overall: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [platform, setPlatform] = useState<PlatformReadiness | null>(null);
  const [rooftop, setRooftop] = useState<RooftopReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs =
        mode === 'rooftop' && dealershipId
          ? `?dealershipId=${encodeURIComponent(dealershipId)}`
          : '';
      const res = await fetch(`/api/owner/pilot-readiness${qs}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = (await res.json().catch(() => ({}))) as PlatformReadiness &
        RooftopReadiness & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Readiness check failed (${res.status})`);
      }
      if (mode === 'rooftop') {
        setRooftop(data as RooftopReadiness);
        setPlatform(null);
        onCanProvisionChange?.(data.overall !== 'blocked', data.overall);
      } else {
        setPlatform(data as PlatformReadiness);
        setRooftop(null);
        onCanProvisionChange?.(Boolean(data.canProvision), data.overall);
      }
    } catch (err) {
      clientLog.error('owner.pilot_readiness_ui_failed', err);
      const message = err instanceof Error ? err.message : 'Readiness check failed';
      setError(message);
      onCanProvisionChange?.(false, null);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [dealershipId, mode, onCanProvisionChange]);

  useEffect(() => {
    if (autoRun) {
      void run();
    }
  }, [autoRun, run]);

  const checks = mode === 'rooftop' ? rooftop?.checks : platform?.checks;
  const overall = mode === 'rooftop' ? rooftop?.overall : platform?.overall;
  const summary =
    mode === 'rooftop'
      ? rooftop
        ? `${rooftop.rooftopName}: ${rooftop.overall.replace(/_/g, ' ')}`
        : null
      : platform?.summary;

  return (
    <div className="apex-readiness apex-card" role="region" aria-label="Pilot readiness checks">
      <div className="apex-readiness-header">
        <div>
          <h3 className="apex-national-panel-title">
            {mode === 'platform' ? 'Step 1 · Platform readiness' : 'Rooftop pilot checklist'}
          </h3>
          <p className="apex-hint">
            {mode === 'platform'
              ? 'Live checks run inside the app (database, KV, encryption, queue, provision flags). Fix red items before creating a rooftop.'
              : 'Verifies this new store is set up for a clean pilot day.'}
          </p>
        </div>
        <button
          type="button"
          className="apex-btn-secondary touch-target"
          disabled={loading}
          aria-busy={loading}
          onClick={() => void run()}
        >
          {loading ? 'Running checks…' : 'Run readiness checks'}
        </button>
      </div>

      {error ? <p className="apex-field-error">{error}</p> : null}

      {overall ? (
        <div className={overallClass(overall)} role="status">
          <strong>{overall.replace(/_/g, ' ').toUpperCase()}</strong>
          {summary ? <span>{summary}</span> : null}
          {platform?.evaluatedAt || rooftop?.evaluatedAt ? (
            <span className="apex-hint">
              Last run:{' '}
              {new Date(platform?.evaluatedAt || rooftop?.evaluatedAt || '').toLocaleString()}
            </span>
          ) : null}
        </div>
      ) : null}

      {checks && checks.length > 0 ? (
        <ul className="apex-readiness-list">
          {checks.map((c) => (
            <li key={c.id} className="apex-readiness-item">
              <span className={statusClass(c.status)}>{c.status}</span>
              <div className="apex-readiness-item-body">
                <strong>
                  {c.title}
                  {c.blocksProvision && c.status === 'fail' ? ' (blocks onboard)' : ''}
                </strong>
                <p className="apex-hint">{c.detail}</p>
                {c.action ? <p className="apex-readiness-action">{c.action}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {platform?.afterProvisionSteps && platform.canProvision ? (
        <div className="apex-readiness-after">
          <h4 className="apex-onboard-cred-heading">After you create the rooftop</h4>
          <ol className="apex-onboard-steps">
            {platform.afterProvisionSteps.map((s) => (
              <li key={s.id}>
                <strong>{s.title}</strong> — {s.detail}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {platform?.ciNote ? <p className="apex-hint apex-readiness-ci-note">{platform.ciNote}</p> : null}
    </div>
  );
}
