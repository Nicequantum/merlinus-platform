'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

type Report = {
  kind: string;
  ranAt: string;
  ok: boolean;
  healthOverall: string;
  criticalFails: string[];
  warnings: string[];
  durationMs: number;
  analysis?: { summary: string; recommendations: string[] } | null;
  warmup?: { database: boolean; grok: boolean; objectStorage: boolean; kv: boolean };
};

type Payload = {
  selfHealEnabled: boolean;
  window: {
    timezone: string;
    localHour: number;
    inWindow: boolean;
    phase: string;
    startHour: number;
    endHour: number;
  };
  latestNightly: Report | null;
  latestMorning: Report | null;
};

/**
 * Manager Health tab — nightly self-heal + morning warmup status.
 */
export function SelfHealStatusCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/self-heal', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      setData((await res.json()) as Payload);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runManual = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/ops/self-heal', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error || `Run failed (${res.status})`);
      toast.success(body.ok ? 'Maintenance run completed' : 'Maintenance finished with issues');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Maintenance run failed');
    } finally {
      setRunning(false);
    }
  };

  const nightly = data?.latestNightly;
  const morning = data?.latestMorning;
  const win = data?.window;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Nightly self-heal & morning warmup
          </h3>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            After-hours health + Grok recommendations (no auto code changes). Window shrinks as
            evening usage grows.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium touch-target dark:border-slate-600"
            disabled={loading || running}
            onClick={() => void load()}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white touch-target dark:bg-teal-700"
            disabled={running || !data?.selfHealEnabled}
            onClick={() => void runManual()}
            title={
              data?.selfHealEnabled
                ? 'Run maintenance now'
                : 'Set GROK_SELF_HEAL_ENABLED=true on Worker'
            }
          >
            {running ? 'Running…' : 'Run now'}
          </button>
        </div>
      </div>

      {!data ? (
        <p className="text-xs text-slate-500">
          {loading ? 'Loading status…' : 'Could not load self-heal status.'}
        </p>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="flex flex-wrap gap-3">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${
                data.selfHealEnabled
                  ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200'
                  : 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100'
              }`}
            >
              Self-heal {data.selfHealEnabled ? 'ON' : 'OFF'}
            </span>
            {win ? (
              <span className="text-slate-600 dark:text-slate-300">
                Window {win.startHour}:00–{win.endHour}:00 {win.timezone}
                {win.inWindow ? ' · in window now' : ' · daytime'}
              </span>
            ) : null}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Last nightly</div>
              {nightly ? (
                <>
                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                    {new Date(nightly.ranAt).toLocaleString()} · {nightly.healthOverall} ·{' '}
                    {nightly.durationMs}ms
                  </div>
                  {nightly.criticalFails?.length ? (
                    <div className="mt-1 text-red-600">Fails: {nightly.criticalFails.join(', ')}</div>
                  ) : (
                    <div className="mt-1 text-teal-700 dark:text-teal-300">No critical fails</div>
                  )}
                  {nightly.analysis?.summary ? (
                    <p className="mt-2 text-slate-700 dark:text-slate-200">{nightly.analysis.summary}</p>
                  ) : null}
                  {nightly.analysis?.recommendations?.length ? (
                    <ul className="mt-1 list-disc pl-4 text-slate-600 dark:text-slate-300">
                      {nightly.analysis.recommendations.slice(0, 4).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-slate-500">No nightly run stored yet (cron pending).</p>
              )}
            </div>
            <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
              <div className="font-semibold text-slate-800 dark:text-slate-100">Last morning warmup</div>
              {morning ? (
                <>
                  <div className="mt-1 text-slate-600 dark:text-slate-300">
                    {new Date(morning.ranAt).toLocaleString()} · {morning.ok ? 'warm' : 'partial'}
                  </div>
                  {morning.warmup ? (
                    <div className="mt-1 grid grid-cols-2 gap-1">
                      {Object.entries(morning.warmup).map(([k, v]) => (
                        <span key={k} className={v ? 'text-teal-700' : 'text-amber-700'}>
                          {k}: {v ? 'ok' : 'miss'}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-slate-500">No morning warmup stored yet.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
