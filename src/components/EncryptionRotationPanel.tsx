'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Loader2,
  AlertTriangle,
  Play,
  StopCircle,
  RefreshCw,
  CheckCircle2,
  Copy,
  ShieldAlert,
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

/**
 * Manager Settings → Security → Encryption Key Rotation
 * Guided flow: generate → deploy secrets → paste/submit new key → re-encrypt.
 */
export function EncryptionRotationPanel() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<{
    primaryFingerprint: string;
    previousFingerprint: string | null;
    dualKeyActive: boolean;
  } | null>(null);
  const [rotation, setRotation] = useState<RotationDto | null>(null);
  const [instructions, setInstructions] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<ReencryptCoverage | null>(null);
  const [mfaStaleProbe, setMfaStaleProbe] = useState<MfaStaleProbe | null>(null);
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);
  const [newKeyFingerprint, setNewKeyFingerprint] = useState<string | null>(null);
  const [previousKeyFingerprint, setPreviousKeyFingerprint] = useState<string | null>(null);
  const [enteredKey, setEnteredKey] = useState('');
  const [autoStartReencrypt, setAutoStartReencrypt] = useState(true);
  const [lastVerifyMessage, setLastVerifyMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEncryptionRotationStatus();
      setKeys(data.keys);
      setRotation((data.rotation as RotationDto) || null);
      setInstructions(data.instructions || []);
      setCoverage((data.coverage as ReencryptCoverage) || null);
      setMfaStaleProbe((data.mfaStaleProbe as MfaStaleProbe) || null);
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

  const enteredLooksValid = enteredKey.trim().length >= 32;

  const fingerprintMatchHint = useMemo(() => {
    if (!newKeyFingerprint || !enteredKey.trim()) return null;
    // Lightweight client hint: compare length only; real FP is server-side
    if (enteredKey.trim().length < 32) return 'Key too short (min 32 characters)';
    return null;
  }, [enteredKey, newKeyFingerprint]);

  const generate = async () => {
    if (
      !confirm(
        'Generate a new encryption key?\n\nYou must copy it, update Worker secrets (PREVIOUS=old, KEY=new), redeploy, then paste the new key and Submit New Key.'
      )
    ) {
      return;
    }
    setBusy(true);
    setLastVerifyMessage(null);
    try {
      const res = await api.beginEncryptionRotation();
      setOneTimeKey(res.newKey);
      setNewKeyFingerprint(res.newKeyFingerprint);
      setPreviousKeyFingerprint(res.previousKeyFingerprint);
      setEnteredKey(res.newKey);
      setRotation(res.rotation as RotationDto);
      toast.success('New key generated — copy it and update Worker secrets');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const submitNewKey = async () => {
    const key = enteredKey.trim();
    if (key.length < 32) {
      toast.error('Paste a key of at least 32 characters');
      return;
    }
    if (
      !confirm(
        autoStartReencrypt
          ? 'Submit new key and start re-encryption?\n\nRequires dual-key already deployed on the Worker.'
          : 'Submit new key for verification only (re-encrypt will not start yet)?'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.confirmEncryptionEnvKey({
        newKey: key,
        rotationId: rotation?.id,
        startReencrypt: autoStartReencrypt,
      });
      setLastVerifyMessage(res.message);
      setRotation(res.rotation as RotationDto);
      toast.success(res.message || 'Key verified');
      // Clear sensitive paste after successful verify
      setEnteredKey('');
      setOneTimeKey(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setBusy(false);
    }
  };

  const startReencrypt = async () => {
    if (!confirm('Start background re-encryption under dual-key decrypt?')) return;
    setBusy(true);
    try {
      const res = await api.startEncryptionReencrypt(rotation?.id);
      setRotation(res.rotation as RotationDto);
      toast.success('Re-encryption started');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Start failed');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!confirm('Cancel active rotation / re-encrypt?')) return;
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

  return (
    <div className="benz-card p-5 mb-5 border border-benz-blue/20">
      <div className="flex items-start gap-2.5 mb-3">
        <KeyRound size={18} className="text-benz-blue shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-sm tracking-tight">Encryption key rotation</div>
          <div className="text-xs text-benz-secondary mt-0.5 leading-relaxed">
            AES-256-GCM dual-key · generate, submit, and re-encrypt from this page. Walks all AES
            columns including MFA secrets. Raw keys are never stored in the database.
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-benz-secondary flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-4">
          {/* Fingerprint comparison */}
          <div className="rounded-lg border border-benz-border/50 px-3 py-2.5 text-xs space-y-2">
            <div className="font-semibold text-benz-secondary">Key fingerprints (never the raw key)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-benz-muted">Live primary</div>
                <code className="font-mono text-[11px]">{keys?.primaryFingerprint || '—'}</code>
              </div>
              <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-benz-muted">Live previous</div>
                <code className="font-mono text-[11px]">
                  {keys?.previousFingerprint || 'none'}
                </code>
              </div>
              {previousKeyFingerprint || newKeyFingerprint ? (
                <>
                  <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-benz-muted">
                      Rotation previous (old)
                    </div>
                    <code className="font-mono text-[11px]">
                      {previousKeyFingerprint || rotation?.previousFingerprint || '—'}
                    </code>
                  </div>
                  <div className="rounded border border-benz-blue/30 bg-benz-blue/5 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-benz-blue">
                      Rotation target (new)
                    </div>
                    <code className="font-mono text-[11px]">
                      {newKeyFingerprint || rotation?.targetFingerprint || '—'}
                    </code>
                  </div>
                </>
              ) : null}
            </div>
            <div>
              Dual-key window:{' '}
              <strong className={keys?.dualKeyActive ? 'text-amber-600' : 'text-emerald-600'}>
                {keys?.dualKeyActive ? 'ACTIVE' : 'off'}
              </strong>
            </div>
            {coverage ? (
              <div className="rounded bg-black/5 dark:bg-white/5 px-2 py-1.5 space-y-1">
                <div className="text-[10px] uppercase tracking-wide text-benz-muted">
                  Full re-encrypt coverage ({coverage.planVersion})
                </div>
                <div className="text-[11px] text-benz-secondary">
                  {coverage.tableCount} tables · {coverage.columnCount} AES columns · MFA:{' '}
                  <strong className={coverage.includesMfa ? 'text-emerald-600' : 'text-red-600'}>
                    {coverage.includesMfa ? 'included' : 'MISSING'}
                  </strong>
                </div>
                <details className="text-[10px] text-benz-muted">
                  <summary className="cursor-pointer select-none">Show tables</summary>
                  <ul className="mt-1 max-h-28 overflow-y-auto space-y-0.5 list-disc list-inside">
                    {coverage.tables.map((t) => (
                      <li key={t.table}>
                        <span className="font-medium text-benz-secondary">{t.label}</span>
                        <span className="font-mono"> ({t.table})</span> — {t.columns.length} col
                        {t.columns.length === 1 ? '' : 's'}
                      </li>
                    ))}
                  </ul>
                </details>
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
                  ? ' — do not remove DATA_ENCRYPTION_KEY_PREVIOUS yet'
                  : ' — clean'}
              </div>
            ) : null}
          </div>

          {keys?.dualKeyActive ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              Dual-key is active. Finish re-encryption (all tables including MFA), validate ROs and
              MFA login, then remove DATA_ENCRYPTION_KEY_PREVIOUS from Worker secrets.
            </div>
          ) : null}

          {/* Step 1: Generate */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-benz-primary">Step 1 — Generate new key</div>
            <button
              type="button"
              className="primary-btn h-10 px-4 text-xs font-semibold flex items-center gap-1.5"
              disabled={busy || keys?.dualKeyActive}
              onClick={() => void generate()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Generate new key
            </button>
          </div>

          {oneTimeKey ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs space-y-2">
              <div className="font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                <ShieldAlert size={14} />
                New key (copy now — not stored server-side)
              </div>
              <code className="block break-all font-mono text-[11px] select-all">{oneTimeKey}</code>
              <button
                type="button"
                className="secondary-btn h-8 px-2 text-[11px] inline-flex items-center gap-1"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(oneTimeKey);
                    toast.success('Copied');
                  } catch {
                    toast.message('Select and copy manually');
                  }
                }}
              >
                <Copy size={12} /> Copy key
              </button>
              <p className="text-benz-secondary leading-relaxed">
                Deploy Worker: <code className="font-mono text-[10px]">PREVIOUS</code> = old key,{' '}
                <code className="font-mono text-[10px]">DATA_ENCRYPTION_KEY</code> = this value, then
                redeploy before submitting below.
              </p>
            </div>
          ) : null}

          {/* Step 2: Submit */}
          <div className="space-y-2 border-t border-benz-border/40 pt-3">
            <div className="text-xs font-semibold text-benz-primary">
              Step 2 — Enter newly rotated key
            </div>
            <label className="block text-[11px] text-benz-muted mb-1">
              Paste the new key after Worker secrets are updated
            </label>
            <textarea
              className="benz-input font-mono text-[11px] min-h-[72px] w-full"
              placeholder="Paste new DATA_ENCRYPTION_KEY here…"
              value={enteredKey}
              onChange={(e) => setEnteredKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {fingerprintMatchHint ? (
              <p className="text-[11px] text-amber-600">{fingerprintMatchHint}</p>
            ) : null}
            <label className="flex items-center gap-2 text-[11px] text-benz-secondary">
              <input
                type="checkbox"
                checked={autoStartReencrypt}
                onChange={(e) => setAutoStartReencrypt(e.target.checked)}
              />
              Start re-encryption automatically after successful verification
            </label>
            <button
              type="button"
              className="primary-btn h-10 px-4 text-xs font-semibold flex items-center gap-1.5"
              disabled={busy || !enteredLooksValid}
              onClick={() => void submitNewKey()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Submit New Key
            </button>
            {lastVerifyMessage ? (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-start gap-1.5">
                <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                {lastVerifyMessage}
              </p>
            ) : null}
          </div>

          {/* Progress */}
          {rotation ? (
            <div className="rounded-lg border border-benz-border/50 px-3 py-2.5 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Rotation <code className="font-mono">{rotation.id.slice(0, 8)}…</code>
                </span>
                <span className="status-pill">{rotation.status}</span>
              </div>
              {rotation.status === 'running' || rotation.progressPercent > 0 ? (
                <>
                  <div className="h-2.5 rounded-full bg-benz-border/40 overflow-hidden">
                    <div
                      className="h-full bg-benz-blue transition-all duration-500"
                      style={{ width: `${Math.max(2, rotation.progressPercent)}%` }}
                    />
                  </div>
                  <div className="text-benz-secondary">
                    {rotation.progressPercent}% · processed {rotation.processedRecords}
                    {rotation.totalRecords ? ` / ~${rotation.totalRecords}` : ''} · updated{' '}
                    {rotation.updatedRecords} · failed {rotation.failedRecords}
                    {rotation.currentTable ? ` · table ${rotation.currentTable}` : ''}
                  </div>
                </>
              ) : null}
              {rotation.errorMessage ? (
                <p className="text-red-600">{rotation.errorMessage}</p>
              ) : null}
              {rotation.status === 'completed' ? (
                <p
                  className={
                    mfaStaleProbe && mfaStaleProbe.stillOnPreviousKey > 0
                      ? 'text-amber-700 dark:text-amber-200 flex items-center gap-1.5'
                      : 'text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5'
                  }
                >
                  {mfaStaleProbe && mfaStaleProbe.stillOnPreviousKey > 0 ? (
                    <>
                      <AlertTriangle size={14} />
                      Job finished but MFA ciphertext still on previous key — re-run re-encryption
                      before removing PREVIOUS.
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} />
                      Re-encryption complete (full AES plan incl. MFA) — remove
                      DATA_ENCRYPTION_KEY_PREVIOUS when MFA probe is clean.
                    </>
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          <ol className="list-decimal list-inside text-[11px] text-benz-muted space-y-1 leading-relaxed">
            {instructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5"
              disabled={busy || !keys?.dualKeyActive}
              onClick={() => void startReencrypt()}
            >
              <Play size={14} />
              Start re-encryption
            </button>
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5 text-red-600"
              disabled={busy || !rotation || rotation.status === 'completed'}
              onClick={() => void cancel()}
            >
              <StopCircle size={14} />
              Cancel
            </button>
            <button
              type="button"
              className="secondary-btn h-10 px-3 text-xs font-semibold flex items-center gap-1.5"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
