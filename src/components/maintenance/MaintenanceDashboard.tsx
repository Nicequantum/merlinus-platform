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

  const ticketCard = (t: MaintenanceTicketSummary) => (
    <button
      key={t.id}
      type="button"
      className="w-full text-left rounded-lg border border-benz-border/60 bg-white p-3 shadow-sm hover:border-benz-blue/40 transition-colors"
      onClick={() => void openDetail(t.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-sm leading-snug">{t.title}</div>
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${severityClass(t.severity)}`}>
          {t.severity}
        </span>
      </div>
      <div className="text-[11px] text-benz-secondary mt-1">
        {t.locationLabel || t.department}
        {t.photoCount ? ` · ${t.photoCount} photo(s)` : ''}
      </div>
      <div className="text-[11px] text-benz-muted mt-1">
        {t.createdByName || 'Staff'}
        {t.assignedToName ? ` → ${t.assignedToName}` : ''}
      </div>
    </button>
  );

  return (
    <div className="benz-page">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-benz-secondary min-w-0">
          {onBack ? (
            <button type="button" className="benz-nav-back !mb-0" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <Wrench size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-benz-primary">Maintenance</span>
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
        <ModuleDisabledNotice title="Maintenance board" moduleId="maintenance" />
      ) : mode === 'board' ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="benz-dashboard-eyebrow">Facility & shop tickets</p>
              <h2 className="benz-page-title text-xl">Maintenance board</h2>
              <p className="benz-hint mt-1">
                Submit issues from any department; maintenance staff prioritize and track work.
              </p>
            </div>
            <button type="button" className="primary-btn h-11 px-4" onClick={openCreate}>
              New ticket
            </button>
          </div>

          {loading ? (
            <p className="benz-hint flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Loading tickets…
            </p>
          ) : (
            <>
              <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
                {MAINTENANCE_KANBAN_COLUMNS.map((col) => (
                  <div
                    key={col}
                    className="min-w-[220px] max-w-[260px] flex-1 rounded-xl border border-benz-border/50 bg-benz-surface/40 p-2"
                  >
                    <div className="flex items-center justify-between px-1 mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-benz-secondary">
                        {MAINTENANCE_STATUS_LABELS[col]}
                      </span>
                      <span className="text-[11px] text-benz-muted">
                        {(columns[col] || []).length}
                      </span>
                    </div>
                    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                      {(columns[col] || []).map(ticketCard)}
                      {(columns[col] || []).length === 0 ? (
                        <p className="text-[11px] text-benz-muted px-1 py-3">Empty</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className="text-xs font-semibold text-benz-blue"
                  onClick={() => setShowClosed((v) => !v)}
                >
                  {showClosed ? 'Hide' : 'Show'} done / cancelled (
                  {(columns.done?.length || 0) + (columns.cancelled?.length || 0)})
                </button>
                {showClosed ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                    <div className="benz-card p-3 space-y-2">
                      <div className="text-xs font-semibold uppercase text-benz-secondary">Done</div>
                      {(columns.done || []).map(ticketCard)}
                    </div>
                    <div className="benz-card p-3 space-y-2">
                      <div className="text-xs font-semibold uppercase text-benz-secondary">
                        Cancelled
                      </div>
                      {(columns.cancelled || []).map(ticketCard)}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </>
      ) : mode === 'create' ? (
        <div>
          <button type="button" className="benz-nav-back" onClick={() => setMode('board')}>
            <ArrowLeft size={18} /> Back
          </button>
          <h2 className="benz-page-title mb-4">New maintenance ticket</h2>
          <div className="space-y-3 max-w-xl">
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
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className="primary-btn h-11 px-4"
                disabled={busy}
                onClick={() => void createTicket()}
              >
                {busy ? 'Submitting…' : 'Submit ticket'}
              </button>
              <button
                type="button"
                className="secondary-btn h-11 px-4"
                disabled={busy}
                onClick={() => setMode('board')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : selected ? (
        <div>
          <button type="button" className="benz-nav-back" onClick={() => setMode('board')}>
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

          <div className="space-y-3 max-w-2xl">
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
                  className="secondary-btn h-9 px-3 text-xs"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus size={14} className="inline mr-1" /> Add photos
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
              className="primary-btn h-11 px-4"
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
