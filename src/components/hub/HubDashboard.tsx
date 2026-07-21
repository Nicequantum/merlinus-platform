'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Loader2,
  Phone,
  Plus,
  Search,
  Sparkles,
  Link2,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TechnicianSession } from '@/types';

type TimelineItem =
  | {
      kind: 'appointment';
      id: string;
      sortAt: string;
      appointment: {
        id: string;
        title: string;
        categoryLabel: string;
        statusLabel: string;
        startsAt: string;
        customerName: string | null;
        customerPhone: string | null;
        vehicleLabel: string | null;
        notes: string | null;
        advisorName: string | null;
        hasShareLink: boolean;
      };
    }
  | {
      kind: 'call';
      id: string;
      sortAt: string;
      call: {
        id: string;
        status: string;
        fromLast4: string;
        durationSec: number | null;
        outcome: string | null;
        activeAgent: string | null;
        agentDisplayName: string | null;
        routingPath: string[];
        tags: string[];
        customerName: string | null;
        vehicleLabel: string | null;
        sentiment: string | null;
        primaryIntent: string | null;
        summary: string | null;
        keyPoints: string[];
        hasInsight: boolean;
        hasRecording: boolean;
        recordingStatus: string | null;
        suggestedAppointment: Record<string, unknown> | null;
        createdAt: string;
      };
    };

interface HubDashboardProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function durationLabel(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function HubDashboard({
  session,
  onOpenSettings,
  onLogout,
  onBack,
}: HubDashboardProps) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [stats, setStats] = useState({
    upcomingAppointments7d: 0,
    openCalls: 0,
    insightsGenerated: 0,
  });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<{
    callVolume: number;
    avgDurationSec: number | null;
    conversionRate: number | null;
    bookedCount: number;
    transferredCount: number;
    peakHours: Array<{ hour: number; count: number }>;
    appointmentsFromVoice: number;
  } | null>(null);
  const [national, setNational] = useState<{
    totals: { appointments7d: number; calls7d: number; insights7d: number };
    rooftops: Array<{
      dealershipName: string;
      appointments7d: number;
      calls7d: number;
      insights7d: number;
    }>;
  } | null>(null);

  // create form
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState('service');

  const isOwnerNational =
    session.role === 'owner' && (session as { scopeMode?: string }).scopeMode === 'national';

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, analyticsRes] = await Promise.all([
        api.getHubTimeline({ q: q || undefined, limit: 100 }),
        api.getHubAnalytics(30).catch(() => null),
      ]);
      setItems(data.items as TimelineItem[]);
      setStats(data.stats);
      if (analyticsRes?.analytics) {
        const a = analyticsRes.analytics;
        setAnalytics({
          callVolume: Number(a.callVolume || 0),
          avgDurationSec:
            typeof a.avgDurationSec === 'number' ? a.avgDurationSec : null,
          conversionRate:
            typeof a.conversionRate === 'number' ? a.conversionRate : null,
          bookedCount: Number(a.bookedCount || 0),
          transferredCount: Number(a.transferredCount || 0),
          peakHours: Array.isArray(a.peakHours)
            ? (a.peakHours as Array<{ hour: number; count: number }>)
            : [],
          appointmentsFromVoice: Number(a.appointmentsFromVoice || 0),
        });
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load hub');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isOwnerNational) return;
    void (async () => {
      try {
        const data = await api.getHubNationalOverview();
        setNational({
          totals: data.totals,
          rooftops: data.rooftops,
        });
      } catch {
        setNational(null);
      }
    })();
  }, [isOwnerNational]);

  const createAppointment = async () => {
    if (!title.trim() || !startsAt) {
      toast.error('Title and start time are required');
      return;
    }
    setBusy(true);
    try {
      await api.createHubAppointment({
        title: title.trim(),
        startsAt: new Date(startsAt).toISOString(),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        vehicleLabel: vehicleLabel.trim() || undefined,
        notes: notes.trim() || undefined,
        category: category as 'service' | 'sales' | 'parts' | 'loaner' | 'other',
      });
      toast.success('Appointment scheduled');
      setShowCreate(false);
      setTitle('');
      setStartsAt('');
      setCustomerName('');
      setCustomerPhone('');
      setVehicleLabel('');
      setNotes('');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not create appointment');
    } finally {
      setBusy(false);
    }
  };

  const summarizeCall = async (callId: string) => {
    setBusy(true);
    try {
      const { insight } = await api.summarizeHubConversation(callId);
      toast.success('AI summary ready');
      // Optimistic: refresh timeline
      void refresh();
      const summary =
        typeof insight.summary === 'string' ? insight.summary : '';
      if (summary) {
        toast.message(summary.slice(0, 140) + (summary.length > 140 ? '…' : ''));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Summarize failed');
    } finally {
      setBusy(false);
    }
  };

  const applySuggestion = async (call: TimelineItem & { kind: 'call' }) => {
    const sug = call.call.suggestedAppointment;
    if (!sug || typeof sug !== 'object') return;
    setShowCreate(true);
    setTitle(String(sug.title || 'Service appointment'));
    setCategory(String(sug.category || 'service'));
    setCustomerName(
      call.call.customerName ||
        (typeof sug.customerName === 'string' ? sug.customerName : '') ||
        ''
    );
    setCustomerPhone(typeof sug.customerPhone === 'string' ? sug.customerPhone : '');
    setVehicleLabel(
      call.call.vehicleLabel ||
        (typeof sug.vehicleLabel === 'string' ? sug.vehicleLabel : '') ||
        ''
    );
    setNotes(
      [
        sug.notes,
        sug.preferredWindow ? `Preferred: ${sug.preferredWindow}` : '',
        `From call ${call.call.id.slice(0, 8)}`,
      ]
        .filter(Boolean)
        .join('\n')
    );
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setStartsAt(local);
    toast.message('Review the suggested appointment and save');
  };

  const createFromCall = async (callId: string) => {
    setBusy(true);
    try {
      const { appointment } = await api.createHubAppointmentFromCall(callId);
      toast.success(
        typeof appointment.title === 'string'
          ? `Booked: ${appointment.title}`
          : 'Appointment created from call'
      );
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not create appointment');
    } finally {
      setBusy(false);
    }
  };

  const shareAppointment = async (id: string) => {
    setBusy(true);
    try {
      const res = await api.patchHubAppointment(id, { createShare: true });
      if (res.shareUrl) {
        try {
          await navigator.clipboard.writeText(res.shareUrl);
          toast.success('Customer portal link copied');
        } catch {
          toast.success(res.shareUrl);
        }
      }
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  };

  const dayGroups = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of items) {
      const day = item.sortAt.slice(0, 10);
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(item);
    }
    return [...map.entries()];
  }, [items]);

  return (
    <div className="benz-page pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 text-sm text-benz-secondary min-w-0">
          {onBack ? (
            <button
              type="button"
              className="benz-nav-back !mb-0 min-h-11 min-w-11 inline-flex items-center justify-center"
              onClick={onBack}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <CalendarDays size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-[var(--benz-text)]">Calendar & Conversations</span>
          <span className="truncate">· {session.dealershipName}</span>
        </div>
        <div className="flex gap-2">
          <button type="button" className="secondary-btn min-h-11 px-4 text-sm" onClick={onOpenSettings}>
            Settings
          </button>
          <button type="button" className="secondary-btn min-h-11 px-4 text-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      <div className="mb-5">
        <p className="benz-dashboard-eyebrow">Unified hub</p>
        <h2 className="benz-page-title text-xl sm:text-2xl !mb-2">Appointments & phone intelligence</h2>
        <p className="benz-hint max-w-2xl">
          One elegant timeline for service appointments and Sophia conversations — AI summaries,
          smart suggestions, full search, and customer portal links.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">Next 7 days</div>
          <div className="text-2xl font-bold tabular-nums">{stats.upcomingAppointments7d}</div>
          <div className="text-xs text-benz-muted">appointments</div>
        </div>
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">Open calls</div>
          <div className="text-2xl font-bold tabular-nums">{stats.openCalls}</div>
          <div className="text-xs text-benz-muted">in progress</div>
        </div>
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">AI insights</div>
          <div className="text-2xl font-bold tabular-nums">{stats.insightsGenerated}</div>
          <div className="text-xs text-benz-muted">summaries</div>
        </div>
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">Call volume</div>
          <div className="text-2xl font-bold tabular-nums">{analytics?.callVolume ?? '—'}</div>
          <div className="text-xs text-benz-muted">30 days</div>
        </div>
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">Conversion</div>
          <div className="text-2xl font-bold tabular-nums">
            {analytics?.conversionRate != null
              ? `${Math.round(analytics.conversionRate * 100)}%`
              : '—'}
          </div>
          <div className="text-xs text-benz-muted">follow-up rate</div>
        </div>
        <div className="benz-card p-4">
          <div className="text-xs uppercase tracking-wide text-benz-secondary mb-1">Avg duration</div>
          <div className="text-2xl font-bold tabular-nums">
            {analytics?.avgDurationSec != null ? durationLabel(analytics.avgDurationSec) : '—'}
          </div>
          <div className="text-xs text-benz-muted">
            peak{' '}
            {analytics?.peakHours?.[0]
              ? `${analytics.peakHours[0].hour}:00`
              : '—'}
          </div>
        </div>
      </div>

      {national ? (
        <section className="benz-card p-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Building2 size={16} className="text-benz-blue" />
            <h3 className="font-semibold text-sm">National overview (7 days)</h3>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div>
              <div className="text-lg font-bold tabular-nums">{national.totals.appointments7d}</div>
              <div className="text-[11px] text-benz-muted">appts</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums">{national.totals.calls7d}</div>
              <div className="text-[11px] text-benz-muted">calls</div>
            </div>
            <div>
              <div className="text-lg font-bold tabular-nums">{national.totals.insights7d}</div>
              <div className="text-[11px] text-benz-muted">insights</div>
            </div>
          </div>
          <ul className="space-y-2 max-h-40 overflow-y-auto text-sm">
            {national.rooftops.map((r) => (
              <li
                key={r.dealershipName}
                className="flex justify-between gap-2 border-b border-benz-border/30 pb-1.5"
              >
                <span className="truncate">{r.dealershipName}</span>
                <span className="text-benz-muted tabular-nums shrink-0">
                  {r.appointments7d}a · {r.calls7d}c
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-5">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-benz-muted pointer-events-none"
          />
          <input
            className="benz-input !pl-10 min-h-12"
            placeholder="Search appointments, callers, intents…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="primary-btn min-h-12 w-full sm:w-auto px-5"
          onClick={() => setShowCreate((v) => !v)}
        >
          <Plus size={16} className="inline mr-1" /> New appointment
        </button>
      </div>

      {showCreate ? (
        <section className="benz-card p-4 sm:p-5 mb-6 space-y-3 max-w-xl">
          <h3 className="font-semibold">Schedule appointment</h3>
          <div>
            <label className="benz-label">Title *</label>
            <input className="benz-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="benz-label">Start *</label>
              <input
                type="datetime-local"
                className="benz-input"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div>
              <label className="benz-label">Category</label>
              <select className="benz-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="service">Service</option>
                <option value="sales">Sales</option>
                <option value="parts">Parts</option>
                <option value="loaner">Loaner</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="benz-label">Customer name</label>
              <input
                className="benz-input"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div>
              <label className="benz-label">Phone</label>
              <input
                className="benz-input"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="benz-label">Vehicle</label>
            <input
              className="benz-input"
              value={vehicleLabel}
              onChange={(e) => setVehicleLabel(e.target.value)}
              placeholder="2022 GLC 300"
            />
          </div>
          <div>
            <label className="benz-label">Notes</label>
            <textarea
              className="benz-textarea min-h-[80px]"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button
              type="button"
              className="primary-btn min-h-12 px-5"
              disabled={busy}
              onClick={() => void createAppointment()}
            >
              {busy ? 'Saving…' : 'Save appointment'}
            </button>
            <button
              type="button"
              className="secondary-btn min-h-12 px-5"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {/* Vertical timeline */}
      {loading ? (
        <p className="benz-hint flex items-center gap-2 justify-center py-12">
          <Loader2 className="animate-spin" size={18} /> Loading hub…
        </p>
      ) : items.length === 0 ? (
        <div className="benz-card p-8 text-center text-benz-secondary">
          No appointments or conversations in this view. Create an appointment or take a Sophia call.
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-w-3xl mx-auto lg:max-w-4xl">
          {dayGroups.map(([day, dayItems]) => (
            <section key={day} className="scroll-mt-4">
              <h3 className="sticky top-0 z-[5] py-2 mb-3 text-xs font-bold uppercase tracking-[0.16em] text-benz-blue bg-[color-mix(in_srgb,var(--benz-bg)_90%,transparent)] backdrop-blur-sm">
                {day}
              </h3>
              <div className="flex flex-col gap-3">
                {dayItems.map((item) =>
                  item.kind === 'appointment' ? (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-benz-border/50 bg-[var(--benz-surface)]/90 p-4 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs text-benz-muted mb-1">
                            <CalendarDays size={14} className="text-benz-blue" />
                            <span>{formatWhen(item.appointment.startsAt)}</span>
                            <span>· {item.appointment.categoryLabel}</span>
                            <span className="status-pill status-pill-warn !text-[10px]">
                              {item.appointment.statusLabel}
                            </span>
                          </div>
                          <h4 className="font-semibold text-[15px] text-[var(--benz-text)]">
                            {item.appointment.title}
                          </h4>
                          <p className="text-sm text-benz-secondary mt-1">
                            {[item.appointment.customerName, item.appointment.vehicleLabel]
                              .filter(Boolean)
                              .join(' · ') || 'No customer details'}
                          </p>
                          {item.appointment.notes ? (
                            <p className="text-xs text-benz-muted mt-2 line-clamp-3">
                              {item.appointment.notes}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          className="secondary-btn min-h-11 px-3 text-xs shrink-0"
                          disabled={busy}
                          onClick={() => void shareAppointment(item.appointment.id)}
                          title="Customer portal link"
                        >
                          <Link2 size={14} className="inline mr-1" /> Portal
                        </button>
                      </div>
                    </article>
                  ) : (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-benz-border/50 bg-[var(--benz-surface-2)]/80 p-4 sm:p-5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-benz-muted mb-1">
                            <Phone size={14} className="text-emerald-400" />
                            <span>{formatWhen(item.call.createdAt)}</span>
                            <span>· …{item.call.fromLast4}</span>
                            <span>· {durationLabel(item.call.durationSec)}</span>
                            {item.call.agentDisplayName || item.call.activeAgent ? (
                              <span className="text-benz-blue">
                                {item.call.agentDisplayName || item.call.activeAgent}
                              </span>
                            ) : null}
                            {item.call.outcome ? (
                              <span className="rounded-full bg-white/5 px-2 py-0.5">
                                {item.call.outcome.replace(/_/g, ' ')}
                              </span>
                            ) : null}
                            {item.call.sentiment ? (
                              <span className="rounded-full bg-white/5 px-2 py-0.5">
                                {item.call.sentiment}
                              </span>
                            ) : null}
                          </div>
                          <h4 className="font-semibold text-[15px]">
                            {item.call.primaryIntent
                              ? item.call.primaryIntent.replace(/_/g, ' ')
                              : 'Phone conversation'}
                          </h4>
                          {(item.call.customerName || item.call.vehicleLabel) && (
                            <p className="text-sm text-benz-secondary mt-1">
                              {[item.call.customerName, item.call.vehicleLabel]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          )}
                          {item.call.summary ? (
                            <p className="text-sm text-benz-secondary mt-1.5 leading-relaxed">
                              {item.call.summary}
                            </p>
                          ) : (
                            <p className="text-sm text-benz-muted mt-1.5">
                              Insight pending — auto-generated when the call completes, or run AI
                              now.
                            </p>
                          )}
                          {item.call.keyPoints?.length ? (
                            <ul className="mt-2 space-y-1">
                              {item.call.keyPoints.map((kp) => (
                                <li key={kp} className="flex gap-2 text-xs text-benz-secondary">
                                  <span className="mt-1.5 h-1 w-1 rounded-full bg-amber-500 shrink-0" />
                                  {kp}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {item.call.tags?.length ? (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {item.call.tags.slice(0, 8).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-benz-border/40 px-2 py-0.5 text-[10px] text-benz-muted"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {playingCallId === item.call.id ? (
                            <audio
                              className="mt-3 w-full"
                              controls
                              autoPlay
                              src={`/api/voice/calls/${item.call.id}/recording/media`}
                              onEnded={() => setPlayingCallId(null)}
                            />
                          ) : null}
                          <div className="flex flex-wrap gap-2 mt-3">
                            <button
                              type="button"
                              className="secondary-btn min-h-10 px-3 text-xs"
                              disabled={busy}
                              onClick={() => void summarizeCall(item.call.id)}
                            >
                              <Sparkles size={14} className="inline mr-1" />
                              {item.call.hasInsight ? 'Refresh AI' : 'AI summarize'}
                            </button>
                            <button
                              type="button"
                              className="primary-btn min-h-10 px-3 text-xs"
                              disabled={busy}
                              onClick={() => void createFromCall(item.call.id)}
                            >
                              Create appointment
                            </button>
                            {item.call.suggestedAppointment ? (
                              <button
                                type="button"
                                className="secondary-btn min-h-10 px-3 text-xs"
                                onClick={() => void applySuggestion(item)}
                              >
                                Edit suggestion
                              </button>
                            ) : null}
                            {item.call.hasRecording ? (
                              <button
                                type="button"
                                className="secondary-btn min-h-10 px-3 text-xs"
                                onClick={() =>
                                  setPlayingCallId((id) =>
                                    id === item.call.id ? null : item.call.id
                                  )
                                }
                              >
                                {playingCallId === item.call.id ? 'Hide audio' : 'Play recording'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
