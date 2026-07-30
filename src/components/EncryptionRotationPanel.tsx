'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Loader2,
  AlertTriangle,
  Play,
  StopCircle,
  RefreshCw,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

type RotationDto = {
  id: string;
  status: string;
  primaryFingerprint: string;
  previousFingerprint: string;
  targetFingerprint: string;
  totalRecords: number;
  processedRecords: number;
  updatedRecords: number;
  failedRecords: number;
  currentTable: string;
  progressPercent: number;
  cancelRequested: boolean;
  errorMessage: string | null;
  dualKeyActive: boolean;
};

type ReencryptCoverage = {
  tableCount: number;
  columnCount: number;
  includesMfa: boolean;
  planVersion: string;
  tables: Array<{ table: string; label: string; columns: string[] }>;
};

type MfaStaleProbe = {
  sampled: number;
  stillOnPreviousKey: number;
  decryptFailed: number;
  tablesChecked: string[];
};

type RotationCadence = {
  recommendedDays: number;
  lastCompletedAt: string | null;
  daysSinceLastCompleted: number | null;
  recommendRotate: boolean;
  neverRotated: boolean;
  dualKeyOpen: boolean;
};

/**
 * Manager Settings → Security → Encryption Key Rotation
 * One-click in-app DEK rotation — no Worker env edits.
 */
export function EncryptionRotationPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const rotateLock = useRef(false);
  const [keys, setKeys] = useState<{
    primaryFingerprint: string;
    previousFingerprint: string | null;
    dualKeyActive: boolean;
    inAppKeyring?: boolean;
    keyringVersion?: number;
    lastRotatedAt?: string | null;
  } | null>(null);
  const [rotation, setRotation] = useState<RotationDto | null>(null);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<ReencryptCoverage | null>(null);
  const [mfaStaleProbe, setMfaStaleProbe] = useState<MfaStaleProbe | null>(null);
  const [cadence, setCadence] = useState<RotationCadence | null>(null);
  const [hmacKeyConfigured, setHmacKeyConfigured] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEncryptionRotationStatus();
      setKeys(data.keys);
      setRotation((data.rotation as RotationDto) || null);
      setInstructions(data.instructions || []);
      setCoverage((data.coverage as ReencryptCoverage) || null);
      setMfaStaleProbe((data.mfaStaleProbe as MfaStaleProbe) || null);
      setCadence((data.cadence as RotationCadence) || null);
      setHmacKeyConfigured(Boolean(data.hmacKeyConfigured));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load encryption status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (rotation?.status !== 'running') return;
    const t = setInterval(() => void load(), 3_500);
    return () => clearInterval(t);
  }, [rotation?.status, load]);

  const rotateNow = async () => {
    if (rotateLock.current || busy) return;
    if (
      !confirm(
        'Rotate encryption keys now?\n\n' +
          '• A new data key is created inside the app (no backend env changes)\n' +
          '• Customer data is re-encrypted in the background\n' +
          '• The shop stays online (dual-key window)\n' +
          '• Recommended about every 90 days'
      )
    ) {
      return;
    }
    rotateLock.current = true;
    setBusy(true);
    setLastMessage(null);
    try {
      const res = await api.rotateEncryptionKeysInApp();
      setRotation(res.rotation as RotationDto);
      setLastMessage(res.message || null);
      toast.success(res.message || 'Key rotation started');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rotation failed');
    } finally {
      setBusy(false);
      // brief lock so double-tap cannot start two jobs
      setTimeout(() => {
        rotateLock.current = false;
      }, 2000);
    }
  };

  const resumeReencrypt = async () => {
    if (!confirm('Resume background re-encryption under the current dual-key window?')) return;
    setBusy(true);
    try {
      const res = await api.startEncryptionReencrypt(rotation?.id);
      setRotation(res.rotation as RotationDto);
      toast.success(res.message || 'Re-encryption started');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (
      !confirm(
        'Retire the previous data key now?\n\nOnly do this after re-encryption is 100% and the MFA probe is clean.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.finalizeEncryptionRotation();
      toast.success(res.message || 'Previous key retired');
      setLastMessage(res.message || null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Finalize failed');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!confirm('Cancel active re-encrypt job?')) return;
    setBusy(true);
    try {
      const res = await api.cancelEncryptionRotation(rotation?.id);
      setRotation(res.rotation as RotationDto);
      toast.message('Cancellation requested');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const running = rotation?.status === 'running';
  const dualOpen = Boolean(keys?.dualKeyActive);
  const mfaClean =
    !mfaStaleProbe || mfaStaleProbe.stillOnPreviousKey === 0 || mfaStaleProbe.sampled === 0;
  const canFinalize =
    dualOpen &&
    !running &&
    (rotation?.status === 'completed' || rotation?.status === 'failed' || !running) &&
    mfaClean;

  return (
    <div className="benz-card p-5 mb-5 border border-benz-blue/20">
      <div className="flex items-start gap-2.5 mb-3">
        <KeyRound size={18} className="text-benz-blue shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-sm tracking-tight">Encryption key rotation</div>
          <div className="text-xs text-benz-secondary mt-0.5 leading-relaxed">
            One-click in-app rotation · AES-256-GCM · no environment variables · includes MFA
            secrets · recommended every 90 days
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-benz-secondary flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-benz-border/50 px-3 py-2.5 text-xs space-y-2">
            <div className="font-semibold text-benz-secondary">Key status (fingerprints only)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-benz-muted">
                  Active data key
                </div>
                <code className="font-mono text-[11px]">{keys?.primaryFingerprint || '—'}</code>
              </div>
              <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-benz-muted">
                  Previous (dual-key)
                </div>
                <code className="font-mono text-[11px]">
                  {keys?.previousFingerprint || 'none'}
                </code>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  dualOpen
                    ? 'bg-amber-500/15 text-amber-900 dark:text-amber-100'
                    : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                }`}
              >
                Dual-key: {dualOpen ? 'open (re-encrypt window)' : 'closed'}
              </span>
              <span className="rounded-full bg-black/5 dark:bg-white/5 px-2 py-0.5 text-benz-secondary">
                {keys?.inAppKeyring
                  ? `In-app keyring v${keys.keyringVersion ?? '—'}`
                  : 'Bootstrap (env master key)'}
              </span>
            </div>
          </div>

          {cadence ? (
            <div
              className={`rounded px-3 py-2 text-[11px] ${
                cadence.recommendRotate
                  ? 'border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
                  : 'bg-black/5 dark:bg-white/5 text-benz-secondary'
              }`}
            >
              <div className="font-semibold mb-0.5">
                Cadence · every {cadence.recommendedDays} days
              </div>
              {cadence.neverRotated ? (
                <div>No completed rotation yet — you can rotate anytime for a fresh data key.</div>
              ) : (
                <div>
                  Last rotated{' '}
                  {cadence.daysSinceLastCompleted != null
                    ? `${cadence.daysSinceLastCompleted} day${
                        cadence.daysSinceLastCompleted === 1 ? '' : 's'
                      } ago`
                    : 'recently'}
                  {cadence.lastCompletedAt
                    ? ` (${new Date(cadence.lastCompletedAt).toLocaleDateString()})`
                    : ''}
                  {cadence.recommendRotate ? ' — rotation recommended.' : '.'}
                </div>
              )}
              <div className="text-[10px] mt-1 opacity-80">
                Master KEK stays in platform secrets (ops). Search HMAC:{' '}
                {hmacKeyConfigured ? 'configured' : 'missing'}.
              </div>
            </div>
          ) : null}

          {coverage ? (
            <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5 text-[11px] text-benz-secondary">
              Re-encrypt plan: {coverage.tableCount} tables · {coverage.columnCount} columns · MFA:{' '}
              <strong className={coverage.includesMfa ? 'text-emerald-600' : 'text-red-600'}>
                {coverage.includesMfa ? 'included' : 'MISSING'}
              </strong>
            </div>
          ) : null}

          {mfaStaleProbe && mfaStaleProbe.sampled > 0 ? (
            <div
              className={`rounded px-2 py-1.5 text-[11px] ${
                mfaStaleProbe.stillOnPreviousKey > 0
                  ? 'border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100'
                  : 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              }`}
            >
              MFA probe: {mfaStaleProbe.stillOnPreviousKey} still on previous key /{' '}
              {mfaStaleProbe.sampled} sampled
              {mfaStaleProbe.stillOnPreviousKey > 0
                ? ' — finish re-encrypt before retiring previous key'
                : ' — clean'}
            </div>
          ) : null}

          {rotation ? (
            <div className="rounded-lg border border-benz-border/50 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-benz-secondary">
                  Job · {rotation.status}
                  {rotation.cancelRequested ? ' (cancel requested)' : ''}
                </span>
                <span className="tabular-nums">{rotation.progressPercent}%</span>
              </div>
              <div className="h-2 rounded-full bg-benz-border/40 overflow-hidden">
                <div
                  className="h-full bg-benz-blue transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, rotation.progressPercent))}%` }}
                />
              </div>
              <div className="text-[11px] text-benz-muted">
                {rotation.processedRecords}/{rotation.totalRecords || '…'} records
                {rotation.currentTable ? ` · ${rotation.currentTable}` : ''}
                {rotation.failedRecords > 0 ? ` · ${rotation.failedRecords} failed` : ''}
              </div>
              {rotation.errorMessage ? (
                <div className="flex items-start gap-1.5 text-[11px] text-red-600">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {rotation.errorMessage}
                </div>
              ) : null}
              {rotation.status === 'completed' ? (
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-200">
                  <CheckCircle2 size={12} /> Re-encryption complete
                </div>
              ) : null}
            </div>
          ) : null}

          {lastMessage ? (
            <p className="text-[11px] text-benz-secondary leading-relaxed">{lastMessage}</p>
          ) : null}

          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            <button
              type="button"
              className="primary-btn h-11 px-4 text-sm font-semibold flex items-center justify-center gap-2"
              disabled={busy || running}
              onClick={() => void rotateNow()}
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ShieldCheck size={16} />
              )}
              {running ? 'Rotation in progress…' : 'Rotate keys now'}
            </button>

            {dualOpen && !running ? (
              <button
                type="button"
                className="secondary-btn h-11 px-3 text-xs font-semibold"
                disabled={busy}
                onClick={() => void resumeReencrypt()}
              >
                <Play size={14} className="inline mr-1" />
                Resume re-encrypt
              </button>
            ) : null}

            {canFinalize ? (
              <button
                type="button"
                className="secondary-btn h-11 px-3 text-xs font-semibold"
                disabled={busy}
                onClick={() => void finalize()}
              >
                <CheckCircle2 size={14} className="inline mr-1" />
                Retire previous key
              </button>
            ) : null}

            {running ? (
              <button
                type="button"
                className="secondary-btn h-11 px-3 text-xs font-semibold"
                disabled={busy}
                onClick={() => void cancel()}
              >
                <StopCircle size={14} className="inline mr-1" />
                Cancel job
              </button>
            ) : null}

            <button
              type="button"
              className="secondary-btn h-11 px-3 text-xs"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {instructions.length > 0 ? (
            <ol className="text-[11px] text-benz-muted list-decimal list-inside space-y-1 leading-relaxed">
              {instructions.map((line) => (
                <li key={line}>{line.replace(/^\d+\.\s*/, '')}</li>
              ))}
            </ol>
          ) : null}
        </div>
      )}
    </div>
  );
}
