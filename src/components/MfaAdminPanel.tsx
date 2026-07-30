'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Shield, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type RosterRow = {
  technicianId: string;
  name: string;
  role: string;
  isAdmin: boolean;
  mfaEnabled: boolean;
  enrolledAt: string | null;
  elevated: boolean;
};

/**
 * Manager Settings → Security → MFA roster + admin reset for locked-out users.
 */
export function MfaAdminPanel() {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [enforcementEnabled, setEnforcementEnabled] = useState(false);
  const [requiredRoles, setRequiredRoles] = useState<string[]>([]);
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [elevatedEnrolled, setElevatedEnrolled] = useState(0);
  const [elevatedTotal, setElevatedTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getMfaRoster();
      setEnforcementEnabled(data.enforcementEnabled);
      setRequiredRoles(data.requiredRoles || []);
      setRows(data.rows || []);
      setElevatedEnrolled(data.elevatedEnrolled ?? 0);
      setElevatedTotal(data.elevatedTotal ?? 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load MFA roster');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetUser = async (row: RosterRow) => {
    if (
      !window.confirm(
        `Clear MFA for ${row.name}? They will sign in with password only until they re-enroll.`
      )
    ) {
      return;
    }
    setBusyId(row.technicianId);
    try {
      const result = await api.adminResetMfa(row.technicianId, 'manager_reset_locked_out');
      toast.success(result.message || `MFA cleared for ${row.name}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="benz-card p-5 mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <Shield size={18} className="text-benz-blue" />
          <div className="font-semibold text-sm tracking-tight">Dealership MFA roster</div>
        </div>
        <button
          type="button"
          className="secondary-btn h-9 px-3 text-xs"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <p className="text-xs text-benz-secondary leading-relaxed mb-3">
        Track authenticator enrollment for elevated roles. Reset clears TOTP and backup codes when
        someone loses their phone — they re-enroll from Settings after the next login.
      </p>

      <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
        <span
          className={`rounded-full px-2.5 py-1 font-medium ${
            enforcementEnabled
              ? 'bg-benz-green/15 text-benz-green'
              : 'bg-amber-500/15 text-amber-800 dark:text-amber-100'
          }`}
        >
          {enforcementEnabled ? 'Enforcement ON' : 'Enforcement OFF (set MERLIN_MFA_ENFORCE=true)'}
        </span>
        <span className="rounded-full bg-[var(--benz-surface-2)] px-2.5 py-1 text-benz-secondary">
          Elevated enrolled {elevatedEnrolled}/{elevatedTotal}
        </span>
        {requiredRoles.length > 0 ? (
          <span className="rounded-full bg-[var(--benz-surface-2)] px-2.5 py-1 text-benz-secondary">
            Roles: {requiredRoles.join(', ')}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-benz-muted py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading roster…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-benz-muted">No active users at this rooftop.</p>
      ) : (
        <ul className="divide-y divide-benz-border/60 max-h-80 overflow-y-auto">
          {rows.map((row) => (
            <li
              key={row.technicianId}
              className="flex items-center justify-between gap-3 py-2.5 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {row.name}
                  {row.elevated ? (
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-benz-blue">
                      elevated
                    </span>
                  ) : null}
                </div>
                <div className="text-[11px] text-benz-muted">
                  {row.role}
                  {row.mfaEnabled && row.enrolledAt
                    ? ` · enrolled ${new Date(row.enrolledAt).toLocaleDateString()}`
                    : ' · not enrolled'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-[11px] font-semibold ${
                    row.mfaEnabled ? 'text-benz-green' : 'text-amber-700 dark:text-amber-200'
                  }`}
                >
                  {row.mfaEnabled ? 'MFA on' : 'MFA off'}
                </span>
                {row.mfaEnabled ? (
                  <button
                    type="button"
                    className="secondary-btn h-8 px-2 text-[11px]"
                    disabled={busyId === row.technicianId}
                    onClick={() => void resetUser(row)}
                    title="Clear authenticator"
                  >
                    {busyId === row.technicianId ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <>
                        <UserX size={12} className="inline mr-1" />
                        Reset
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
