'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, AlertTriangle, Play, StopCircle, RefreshCw } from 'lucide-react';
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
  liveKeyStatus: {
    primaryFingerprint: string;
    previousFingerprint: string | null;
    dualKeyActive: boolean;
    recommendCloseDualKey: boolean;
  };
};

/**
 * Manager Settings → Security → Encryption Key Rotation
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
  const [oneTimeKey, setOneTimeKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getEncryptionRotationStatus();
      setKeys(data.keys);
      setRotation((data.rotation as RotationDto) || null);
      setInstructions(data.instructions || []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load encryption status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll progress while running
  useEffect(() => {
    if (rotation?.status !== 'running') return;
    const t = setInterval(() => void load(), 4_000);
    return () => clearInterval(t);
  }, [rotation?.status, load]);

  const begin = async () => {
    if (
      !confirm(
        'Generate a new encryption key?\n\nYou must copy it immediately and update Worker secrets. Incorrect handling can make PII unreadable.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.beginEncryptionRotation();
      setOneTimeKey(res.newKey);
      setRotation(res.rotation as RotationDto);
      toast.success('New key generated — copy it now (shown once)');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Begin failed');
    } finally {
      setBusy(false);
    }
  };

  const startReencrypt = async () => {
    if (
      !confirm(
        'Start background re-encryption?\n\nRequires dual-key env: PREVIOUS=old key, DATA_ENCRYPTION_KEY=new key (already deployed).'
      )
    ) {
      return;
    }
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
    <div className="benz-card p-5 mb-5">
      <div className="flex items-start gap-2.5 mb-3">
        <KeyRound size={18} className="text-benz-blue shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold text-sm tracking-tight">Encryption key rotation</div>
          <div className="text-xs text-benz-secondary mt-0.5 leading-relaxed">
            AES-256-GCM dual-key window · zero-downtime re-encrypt of PII at rest. Keys never leave
            Worker secrets after deploy.
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-benz-secondary flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-benz-border/50 px-3 py-2.5 text-xs space-y-1">
            <div>
              Primary fingerprint:{' '}
              <code className="font-mono">{keys?.primaryFingerprint || '—'}</code>
            </div>
            <div>
              Previous fingerprint:{' '}
              <code className="font-mono">{keys?.previousFingerprint || 'none'}</code>
            </div>
            <div>
              Dual-key window:{' '}
              <strong className={keys?.dualKeyActive ? 'text-amber-600' : 'text-emerald-600'}>
                {keys?.dualKeyActive ? 'ACTIVE' : 'off'}
              </strong>
            </div>
          </div>

          {keys?.dualKeyActive ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              Dual-key is active. Finish re-encryption, validate the app, then remove
              DATA_ENCRYPTION_KEY_PREVIOUS from Worker secrets.
            </div>
          ) : null}

          {oneTimeKey ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs space-y-2">
              <div className="font-semibold text-red-700 dark:text-red-300">
                New key (copy once — not stored server-side)
              </div>
              <code className="block break-all font-mono text-[11px] select-all">{oneTimeKey}</code>
              <p className="text-benz-secondary leading-relaxed">
                1) Set DATA_ENCRYPTION_KEY_PREVIOUS to the <em>current</em> key
                <br />
                2) Set DATA_ENCRYPTION_KEY to this new value
                <br />
                3) Deploy Worker · then Start re-encryption
              </p>
              <button
                type="button"
                className="secondary-btn h-8 px-2 text-[11px]"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(oneTimeKey);
                    toast.success('Copied to clipboard');
                  } catch {
                    toast.message('Select and copy manually');
                  }
                }}
              >
                Copy key
              </button>
            </div>
          ) : null}

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
                  <div className="h-2 rounded-full bg-benz-border/40 overflow-hidden">
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
              className="primary-btn h-10 px-4 text-xs font-semibold flex items-center gap-1.5"
              disabled={busy || keys?.dualKeyActive}
              onClick={() => void begin()}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
              Begin rotation
            </button>
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
