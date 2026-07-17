'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Phone, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ModuleDisabledNotice } from '@/components/modules/ModuleDisabledNotice';
import type { TechnicianSession } from '@/types';

interface VoiceOpsDashboardProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
}

type CallRow = {
  id: string;
  status: string;
  fromLast4: string;
  toE164: string;
  durationSec: number | null;
  activeAgent: string | null;
  routingPath: string[];
  segmentCount: number;
  contained: boolean | null;
  outcome: string | null;
  recordingStatus: string;
  hasRecording: boolean;
  createdAt: string;
};

type CallDetail = {
  id: string;
  status: string;
  fromLast4: string;
  routingPath: string[];
  activeAgent: string | null;
  contained: boolean | null;
  outcome: string | null;
  metrics: Record<string, unknown>;
  handoffs: Array<{ from: string; to: string; at: string; reason?: string; brief?: string }>;
  slots: Record<string, unknown>;
  segments: Array<{
    id: string;
    speaker: string;
    agentName: string | null;
    text: string;
    createdAt: string;
  }>;
  hasRecording: boolean;
  recordingStatus: string;
  fullTranscript: string | null;
};

type Metrics = {
  days: number;
  totalCalls: number;
  completedCalls: number;
  containedCalls: number;
  containmentRate: number | null;
  avgHandoffs: number | null;
  avgTurns: number | null;
  workItemRate: number | null;
  outcomes: Record<string, number>;
  agentShare: Record<string, number>;
};

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Math.round(n * 100)}%`;
}

export function VoiceOpsDashboard({
  session,
  onOpenSettings,
  onLogout,
  onBack,
}: VoiceOpsDashboardProps) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [selected, setSelected] = useState<CallDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lineNumber, setLineNumber] = useState('');
  const [lineLabel, setLineLabel] = useState('Main');
  const [lines, setLines] = useState<Array<{ id: string; e164Number: string; label: string }>>(
    []
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setModuleDisabled(false);
    try {
      const [callRes, metricRes, lineRes] = await Promise.all([
        api.listVoiceCalls(),
        api.getVoiceMetrics(30),
        api.listVoiceAgentLines(),
      ]);
      setCalls(callRes.calls as CallRow[]);
      setMetrics(metricRes as unknown as Metrics);
      setLines(
        lineRes.lines.map((l) => ({
          id: l.id,
          e164Number: l.e164Number,
          label: l.label,
        }))
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load voice ops';
      if (/module|not enabled|MODULE_DISABLED/i.test(msg)) setModuleDisabled(true);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCall = async (id: string) => {
    setDetailLoading(true);
    try {
      const { call } = await api.getVoiceCall(id);
      setSelected(call as unknown as CallDetail);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load call');
    } finally {
      setDetailLoading(false);
    }
  };

  const createLine = async () => {
    if (!lineNumber.trim()) {
      toast.error('E.164 number required');
      return;
    }
    setBusy(true);
    try {
      await api.createVoiceAgentLine({
        e164Number: lineNumber.trim(),
        label: lineLabel.trim() || 'Main',
      });
      toast.success('Voice line registered');
      setLineNumber('');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not create line');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="benz-page">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-benz-secondary min-w-0">
          {onBack ? (
            <button type="button" className="benz-nav-back !mb-0" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <Phone size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-benz-primary">Voice agent</span>
          <span className="truncate">· {session.dealershipName}</span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="secondary-btn h-9 px-3 text-xs" onClick={onOpenSettings}>
            Settings
          </button>
          <button type="button" className="secondary-btn h-9 px-3 text-xs" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      {moduleDisabled ? (
        <ModuleDisabledNotice title="AI Voice Agent" moduleId="voice_agent" />
      ) : selected ? (
        <div>
          <button
            type="button"
            className="benz-nav-back"
            onClick={() => setSelected(null)}
            disabled={detailLoading}
          >
            <ArrowLeft size={18} /> Back to calls
          </button>
          {detailLoading ? (
            <p className="benz-hint flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Loading transcript…
            </p>
          ) : (
            <>
              <h2 className="benz-page-title mb-2">Call detail</h2>
              <p className="text-xs text-benz-secondary mb-4">
                …{selected.fromLast4} · {selected.status} · agent {selected.activeAgent || '—'}
                {selected.contained != null
                  ? ` · ${selected.contained ? 'contained' : 'not contained'}`
                  : ''}
                {selected.outcome ? ` · ${selected.outcome}` : ''}
                {selected.hasRecording ? ` · recording ${selected.recordingStatus}` : ''}
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 benz-card p-4 space-y-2 max-h-[60vh] overflow-y-auto">
                  <div className="font-semibold text-sm mb-2">Transcript</div>
                  {selected.segments.length === 0 ? (
                    <p className="text-xs text-benz-secondary">No segments yet.</p>
                  ) : (
                    selected.segments.map((s) => (
                      <div
                        key={s.id}
                        className={`text-sm rounded-lg px-3 py-2 ${
                          s.speaker === 'caller'
                            ? 'bg-benz-blue/10'
                            : s.speaker === 'system'
                              ? 'bg-slate-100 text-benz-secondary'
                              : 'bg-emerald-50'
                        }`}
                      >
                        <div className="text-[10px] font-semibold uppercase text-benz-secondary mb-0.5">
                          {s.speaker}
                          {s.agentName ? ` · ${s.agentName}` : ''} ·{' '}
                          {new Date(s.createdAt).toLocaleTimeString()}
                        </div>
                        {s.text}
                      </div>
                    ))
                  )}
                </div>
                <div className="space-y-3">
                  <div className="benz-card p-4 text-xs space-y-1">
                    <div className="font-semibold text-sm mb-1">Routing</div>
                    <div>{(selected.routingPath || []).join(' → ') || '—'}</div>
                    <div className="font-semibold text-sm mt-3 mb-1">Handoffs</div>
                    {(selected.handoffs || []).length === 0 ? (
                      <div className="text-benz-secondary">None</div>
                    ) : (
                      (selected.handoffs || []).map((h, i) => (
                        <div key={i} className="border-b border-benz-border/40 pb-1 mb-1">
                          {h.from} → {h.to}
                          {h.reason ? ` (${h.reason})` : ''}
                          {h.brief ? <div className="text-benz-secondary">{h.brief}</div> : null}
                        </div>
                      ))
                    )}
                    <div className="font-semibold text-sm mt-3 mb-1">Slots</div>
                    <pre className="text-[10px] whitespace-pre-wrap break-all text-benz-secondary">
                      {JSON.stringify(selected.slots || {}, null, 2)}
                    </pre>
                    <div className="font-semibold text-sm mt-3 mb-1">Metrics</div>
                    <pre className="text-[10px] whitespace-pre-wrap break-all text-benz-secondary">
                      {JSON.stringify(selected.metrics || {}, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="mb-4">
            <p className="benz-dashboard-eyebrow">Multi-agent phone ops</p>
            <h2 className="benz-page-title text-xl">Receptionist quality</h2>
          </div>

          {loading ? (
            <p className="benz-hint flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </p>
          ) : (
            <>
              {metrics ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="stat-card p-4">
                    <div className="text-xs uppercase text-benz-secondary mb-1">Calls (30d)</div>
                    <div className="text-2xl font-bold">{metrics.totalCalls}</div>
                  </div>
                  <div className="stat-card p-4">
                    <div className="text-xs uppercase text-benz-secondary mb-1">Containment</div>
                    <div className="text-2xl font-bold">{pct(metrics.containmentRate)}</div>
                    <div className="text-[11px] text-benz-muted">
                      {metrics.containedCalls} contained
                    </div>
                  </div>
                  <div className="stat-card p-4">
                    <div className="text-xs uppercase text-benz-secondary mb-1">Avg handoffs</div>
                    <div className="text-2xl font-bold">
                      {metrics.avgHandoffs == null ? '—' : metrics.avgHandoffs.toFixed(1)}
                    </div>
                  </div>
                  <div className="stat-card p-4">
                    <div className="text-xs uppercase text-benz-secondary mb-1">Work item rate</div>
                    <div className="text-2xl font-bold">{pct(metrics.workItemRate)}</div>
                  </div>
                </div>
              ) : null}

              <div className="benz-card p-4 mb-6">
                <div className="font-semibold text-sm mb-2">Phone lines</div>
                {lines.length === 0 ? (
                  <p className="text-xs text-benz-secondary mb-3">
                    No DIDs registered. Add the Twilio number (E.164) and point Voice URL to
                    /api/voice/inbound. Recording callback: /api/voice/recording.
                  </p>
                ) : (
                  <ul className="text-xs space-y-1 mb-3">
                    {lines.map((l) => (
                      <li key={l.id}>
                        <span className="font-semibold">{l.label}</span> · {l.e164Number}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <input
                    className="benz-input flex-1 min-w-[10rem]"
                    placeholder="+15551234567"
                    value={lineNumber}
                    onChange={(e) => setLineNumber(e.target.value)}
                  />
                  <input
                    className="benz-input w-28"
                    placeholder="Label"
                    value={lineLabel}
                    onChange={(e) => setLineLabel(e.target.value)}
                  />
                  <button
                    type="button"
                    className="primary-btn h-11 px-4 text-xs"
                    disabled={busy}
                    onClick={() => void createLine()}
                  >
                    Add line
                  </button>
                </div>
              </div>

              <div className="benz-card p-4">
                <div className="font-semibold text-sm mb-3">Recent calls</div>
                {calls.length === 0 ? (
                  <p className="text-xs text-benz-secondary">No calls yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {calls.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full text-left rounded-lg border border-benz-border/50 px-3 py-2.5 hover:border-benz-blue/40"
                          onClick={() => void openCall(c.id)}
                        >
                          <div className="flex justify-between gap-2 text-sm">
                            <span className="font-semibold">
                              …{c.fromLast4 || '????'} · {c.status}
                            </span>
                            <span className="text-xs text-benz-secondary">
                              {c.segmentCount} segs
                              {c.contained === true
                                ? ' · contained'
                                : c.contained === false
                                  ? ' · open'
                                  : ''}
                            </span>
                          </div>
                          <div className="text-[11px] text-benz-secondary mt-0.5">
                            {(c.routingPath || []).join(' → ') || c.activeAgent || '—'}
                            {c.outcome ? ` · ${c.outcome}` : ''}
                            {c.hasRecording ? ' · rec' : ''}
                            {' · '}
                            {new Date(c.createdAt).toLocaleString()}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
