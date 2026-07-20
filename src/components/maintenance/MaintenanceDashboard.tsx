'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ClipboardList,
  ImagePlus,
  Loader2,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ModuleDisabledNotice } from '@/components/modules/ModuleDisabledNotice';
import { effectiveRole } from '@/lib/apex/viewAs';
import {
  canManageMaintenance,
  MAINTENANCE_DEPARTMENTS,
  MAINTENANCE_KANBAN_COLUMNS,
  MAINTENANCE_SEVERITIES,
  MAINTENANCE_SEVERITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
  MAINTENANCE_STATUSES,
  type MaintenanceSeverity,
  type MaintenanceTicketStatus,
} from '@/lib/maintenance/constants';
import type {
  MaintenanceTicketDetail,
  MaintenanceTicketSummary,
  TechnicianSession,
} from '@/types';

interface MaintenanceDashboardProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  /** When embedded under manager shell, show back control. */
  onBack?: () => void;
}

type Mode = 'board' | 'create' | 'detail';

function severityClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-600 text-white';
    case 'high':
      return 'bg-orange-500 text-white';
    case 'medium':
      return 'bg-amber-400 text-black';
    default:
      return 'bg-slate-300 text-slate-800';
  }
}

export function MaintenanceDashboard({
  session,
  onOpenSettings,
  onLogout,
  onBack,
}: MaintenanceDashboardProps) {
  const role = effectiveRole(session);
  const canManage = canManageMaintenance(role);

  const [mode, setMode] = useState<Mode>('board');
  const [tickets, setTickets] = useState<MaintenanceTicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [selected, setSelected] = useState<MaintenanceTicketDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<MaintenanceSeverity>('medium');
  const [department, setDepartment] = useState('facilities');
  const [locationLabel, setLocationLabel] = useState('');
  const [comment, setComment] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setModuleDisabled(false);
    try {
      const data = await api.listMaintenanceTickets();
      setTickets(data.tickets);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load tickets';
      if (/module|not enabled|MODULE_DISABLED/i.test(msg)) setModuleDisabled(true);
      toast.error(msg);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = useMemo(() => {
    const map: Record<string, MaintenanceTicketSummary[]> = {};
    for (const col of MAINTENANCE_KANBAN_COLUMNS) map[col] = [];
    map.done = [];
    map.cancelled = [];
    for (const t of tickets) {
      if (map[t.status]) map[t.status].push(t);
      else if (t.status === 'done' || t.status === 'cancelled') map[t.status].push(t);
      else map.submitted.push(t);
    }
    return map;
  }, [tickets]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setSeverity('medium');
    setDepartment('facilities');
    setLocationLabel('');
    setComment('');
  };

  const openCreate = () => {
    resetForm();
    setSelected(null);
    setMode('create');
  };

  const openDetail = async (id: string) => {
    setBusy(true);
    try {
      const { ticket } = await api.getMaintenanceTicket(id);
      setSelected(ticket);
      setTitle(ticket.title);
      setDescription(ticket.description);
      setSeverity(ticket.severity as MaintenanceSeverity);
      setDepartment(ticket.department);
      setLocationLabel(ticket.locationLabel || '');
      setComment('');
      setMode('detail');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not open ticket');
    } finally {
      setBusy(false);
    }
  };

  const createTicket = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setBusy(true);
    try {
      const { ticket } = await api.createMaintenanceTicket({
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        department,
        locationLabel: locationLabel.trim() || undefined,
      });
      toast.success('Maintenance ticket submitted');
      setSelected(ticket);
      setMode('detail');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const saveDetail = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const body: Parameters<typeof api.patchMaintenanceTicket>[1] = {
        title: title.trim(),
        description,
        department,
        locationLabel: locationLabel || null,
      };
      if (canManage) {
        body.severity = severity;
      }
      if (comment.trim()) body.comment = comment.trim();
      const { ticket } = await api.patchMaintenanceTicket(selected.id, body);
      setSelected(ticket);
      setComment('');
      toast.success('Ticket saved');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const moveStatus = async (status: string) => {
    if (!selected || !canManage) return;
    setBusy(true);
    try {
      const { ticket } = await api.patchMaintenanceTicket(selected.id, { status });
      setSelected(ticket);
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!selected || !files?.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      Array.from(files).slice(0, 6).forEach((f) => form.append('photos', f));
      const { ticket } = await api.uploadMaintenancePhotos(selected.id, form);
      setSelected(ticket);
      toast.success('Photos uploaded');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Photo upload failed');
    } finally {
      setBusy(false);
    }
  };

  const scrollToSection = (statusId: string) => {
    const el = document.getElementById(`maint-section-${statusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const ticketCard = (t: MaintenanceTicketSummary) => (
    <button
      key={t.id}
      type="button"
      className="w-full min-h-[4.5rem] text-left rounded-xl border border-benz-border/60 bg-[var(--benz-surface-2)] px-4 py-3.5 shadow-sm active:scale-[0.99] hover:border-benz-blue/40 hover:bg-[var(--benz-surface-3)] transition-all touch-manipulation"
      onClick={() => void openDetail(t.id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-semibold text-[15px] leading-snug text-[var(--benz-text)] min-w-0">
          {t.title}
        </div>
        <span
          className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md ${severityClass(t.severity)}`}
        >
          {MAINTENANCE_SEVERITY_LABELS[t.severity as MaintenanceSeverity] || t.severity}
        </span>
      </div>
      <div className="text-sm text-[var(--benz-text-secondary)] mt-2">
        {t.locationLabel || t.department}
        {t.photoCount ? ` · ${t.photoCount} photo${t.photoCount === 1 ? '' : 's'}` : ''}
      </div>
      <div className="text-xs text-[var(--benz-text-muted)] mt-1.5">
        {t.createdByName || 'Staff'}
        {t.assignedToName ? ` → ${t.assignedToName}` : ''}
      </div>
    </button>
  );

  const statusSection = (
    status: MaintenanceTicketStatus,
    options?: { muted?: boolean }
  ) => {
    const list = columns[status] || [];
    const muted = options?.muted;
    return (
      <section
        key={status}
        id={`maint-section-${status}`}
        className={`scroll-mt-24 rounded-2xl border overflow-hidden ${
          muted
            ? 'border-benz-border/30 bg-[var(--benz-surface)]/60'
            : 'border-benz-border/50 bg-[var(--benz-surface)]/90'
        }`}
      >
        <header className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-benz-border/40 bg-[var(--benz-surface-2)]/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                status === 'blocked'
                  ? 'bg-red-400'
                  : status === 'in_progress'
                    ? 'bg-benz-blue'
                    : status === 'scheduled'
                      ? 'bg-violet-400'
                      : status === 'triage'
                        ? 'bg-amber-400'
                        : status === 'done'
                          ? 'bg-emerald-400'
                          : status === 'cancelled'
                            ? 'bg-slate-500'
                            : 'bg-sky-400'
              }`}
              aria-hidden
            />
            <h3 className="text-sm font-semibold tracking-wide text-[var(--benz-text)]">
              {MAINTENANCE_STATUS_LABELS[status]}
            </h3>
          </div>
          <span
            className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full bg-benz-blue/15 px-2.5 py-1 text-xs font-bold tabular-nums text-benz-blue"
            aria-label={`${list.length} tickets`}
          >
            {list.length}
          </span>
        </header>
        <div className="p-3 sm:p-4 space-y-2.5">
          {list.length === 0 ? (
            <p className="text-sm text-[var(--benz-text-muted)] px-1 py-5 text-center">
              No tickets in this stage
            </p>
          ) : (
            list.map(ticketCard)
          )}
        </div>
      </section>
    );
  };

  const activeTicketCount = MAINTENANCE_KANBAN_COLUMNS.reduce(
    (n, col) => n + (columns[col]?.length || 0),
    0
  );
  const closedTicketCount =
    (columns.done?.length || 0) + (columns.cancelled?.length || 0);

  return (
    <div className="benz-page pb-8">
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
          <Wrench size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-benz-primary">Maintenance</span>
          <span className="truncate">· {session.dealershipName}</span>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            className="secondary-btn min-h-11 px-4 text-sm"
            onClick={onOpenSettings}
          >
            Settings
          </button>
          <button type="button" className="secondary-btn min-h-11 px-4 text-sm" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </div>

      {moduleDisabled ? (
        <ModuleDisabledNotice title="Maintenance board" moduleId="maintenance" />
      ) : mode === 'board' ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-5">
            <div className="min-w-0">
              <p className="benz-dashboard-eyebrow">Facility & shop tickets</p>
              <h2 className="benz-page-title text-xl sm:text-2xl">Maintenance board</h2>
              <p className="benz-hint mt-1 max-w-xl">
                Submit issues from any department; maintenance staff prioritize and track work.
                Scroll down through each status stage.
              </p>
              {!loading ? (
                <p className="text-xs text-benz-muted mt-2 tabular-nums">
                  {activeTicketCount} active · {closedTicketCount} closed
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="primary-btn min-h-12 w-full sm:w-auto px-5 text-base shrink-0"
              onClick={openCreate}
            >
              New ticket
            </button>
          </div>

          {loading ? (
            <p className="benz-hint flex items-center gap-2 py-8 justify-center">
              <Loader2 className="animate-spin" size={18} /> Loading tickets…
            </p>
          ) : (
            <>
              {/* Status jump chips — jump down the vertical stack (no horizontal swipe) */}
              <nav
                className="sticky top-0 z-10 -mx-1 mb-5 px-1 py-2.5 bg-[color-mix(in_srgb,var(--benz-bg)_88%,transparent)] backdrop-blur-md border-b border-benz-border/30"
                aria-label="Jump to status"
              >
                <div className="flex flex-wrap gap-2">
                  {MAINTENANCE_KANBAN_COLUMNS.map((col) => {
                    const count = (columns[col] || []).length;
                    return (
                      <button
                        key={col}
                        type="button"
                        className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-benz-border/60 bg-[var(--benz-surface-2)] px-3.5 text-sm font-medium text-[var(--benz-text)] shadow-sm active:bg-benz-blue/10 hover:border-benz-blue/40 transition-colors touch-manipulation"
                        onClick={() => scrollToSection(col)}
                      >
                        {MAINTENANCE_STATUS_LABELS[col]}
                        <span className="rounded-full bg-benz-blue/15 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-benz-blue">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* Vertical stack: one status section below the next */}
              <div className="flex flex-col gap-4 sm:gap-5 w-full max-w-3xl mx-auto lg:max-w-4xl">
                {MAINTENANCE_KANBAN_COLUMNS.map((col) => statusSection(col))}

                <div className="pt-1">
                  <button
                    type="button"
                    className="min-h-11 w-full sm:w-auto rounded-xl border border-benz-border/50 bg-[var(--benz-surface-2)] px-4 text-sm font-semibold text-benz-blue shadow-sm active:bg-benz-blue/10 touch-manipulation"
                    onClick={() => setShowClosed((v) => !v)}
                    aria-expanded={showClosed}
                  >
                    {showClosed ? 'Hide' : 'Show'} done / cancelled ({closedTicketCount})
                  </button>
                </div>

                {showClosed ? (
                  <div className="flex flex-col gap-4">
                    {statusSection('done', { muted: true })}
                    {statusSection('cancelled', { muted: true })}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : mode === 'create' ? (
        <div className="max-w-xl">
          <button
            type="button"
            className="benz-nav-back min-h-11"
            onClick={() => setMode('board')}
          >
            <ArrowLeft size={18} /> Back
          </button>
          <h2 className="benz-page-title mb-4">New maintenance ticket</h2>
          <div className="space-y-3">
            <div>
              <label className="benz-label">Title *</label>
              <input
                className="benz-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Bay 3 lift slow to raise"
              />
            </div>
            <div>
              <label className="benz-label">Description</label>
              <textarea
                className="benz-textarea min-h-[120px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is broken, when it started, safety impact…"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="benz-label">Severity</label>
                <select
                  className="benz-input"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as MaintenanceSeverity)}
                >
                  {MAINTENANCE_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {MAINTENANCE_SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="benz-label">Department</label>
                <select
                  className="benz-input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  {MAINTENANCE_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="benz-label">Location</label>
                <input
                  className="benz-input"
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                  placeholder="Bay 3, detail bay, lot B…"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
              <button
                type="button"
                className="primary-btn min-h-12 w-full sm:w-auto px-5"
                disabled={busy}
                onClick={() => void createTicket()}
              >
                {busy ? 'Submitting…' : 'Submit ticket'}
              </button>
              <button
                type="button"
                className="secondary-btn min-h-12 w-full sm:w-auto px-5"
                disabled={busy}
                onClick={() => setMode('board')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : selected ? (
        <div className="max-w-2xl">
          <button
            type="button"
            className="benz-nav-back min-h-11"
            onClick={() => setMode('board')}
          >
            <ArrowLeft size={18} /> Back to board
          </button>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h2 className="benz-page-title">Ticket</h2>
            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${severityClass(selected.severity)}`}>
              {selected.severity}
            </span>
            {canManage ? (
              <select
                className="benz-input text-sm w-auto"
                value={selected.status}
                disabled={busy}
                onChange={(e) => {
                  setSelected({ ...selected, status: e.target.value });
                  void moveStatus(e.target.value);
                }}
              >
                {MAINTENANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {MAINTENANCE_STATUS_LABELS[s as MaintenanceTicketStatus]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="status-pill status-pill-warn">
                {MAINTENANCE_STATUS_LABELS[selected.status as MaintenanceTicketStatus] ||
                  selected.status}
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="benz-label">Title</label>
              <input
                className="benz-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={!canManage && selected.createdById !== session.technicianId}
              />
            </div>
            <div>
              <label className="benz-label">Description</label>
              <textarea
                className="benz-textarea min-h-[120px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!canManage && selected.createdById !== session.technicianId}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="benz-label">Severity</label>
                <select
                  className="benz-input"
                  value={severity}
                  disabled={!canManage}
                  onChange={(e) => setSeverity(e.target.value as MaintenanceSeverity)}
                >
                  {MAINTENANCE_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {MAINTENANCE_SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="benz-label">Department</label>
                <select
                  className="benz-input"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  {MAINTENANCE_DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="benz-label">Location</label>
                <input
                  className="benz-input"
                  value={locationLabel}
                  onChange={(e) => setLocationLabel(e.target.value)}
                />
              </div>
            </div>

            <div className="benz-card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm flex items-center gap-2">
                  <ClipboardList size={16} /> Photos
                </div>
                <button
                  type="button"
                  className="secondary-btn min-h-11 px-3 text-sm"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={16} className="inline mr-1" /> Add photos
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void uploadPhotos(e.target.files)}
                />
              </div>
              {selected.photos.length === 0 ? (
                <p className="text-xs text-benz-secondary">No photos yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={p.id}
                      src={p.url}
                      alt=""
                      className="w-20 h-20 object-cover rounded-md border border-benz-border/50"
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="benz-label">Add comment</label>
              <textarea
                className="benz-textarea min-h-[72px]"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Update for the team…"
              />
            </div>

            <div className="benz-card p-4">
              <div className="font-semibold text-sm mb-2">Activity</div>
              {selected.events.length === 0 ? (
                <p className="text-xs text-benz-secondary">No events yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {selected.events.map((ev) => (
                    <li key={ev.id} className="border-b border-benz-border/40 pb-2">
                      <div className="font-medium">
                        {ev.type.replace(/_/g, ' ')}
                        {ev.actorName ? ` · ${ev.actorName}` : ''}
                      </div>
                      {ev.payload ? (
                        <div className="text-benz-secondary mt-0.5 break-words">{ev.payload}</div>
                      ) : null}
                      <div className="text-benz-muted mt-0.5">
                        {new Date(ev.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              type="button"
              className="primary-btn min-h-12 w-full sm:w-auto px-5"
              disabled={busy}
              onClick={() => void saveDetail()}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
