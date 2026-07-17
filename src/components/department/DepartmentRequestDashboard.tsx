'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Briefcase, Package, Plus, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { DepartmentInbox } from '@/components/department/DepartmentInbox';
import { ModuleDisabledNotice } from '@/components/modules/ModuleDisabledNotice';
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_REQUEST_PRIORITIES,
  DEPARTMENT_REQUEST_STATUSES,
  INBOX_EMPTY_COPY,
  INBOX_MODULE_HINT,
  PARTS_LINE_STATUSES,
  moduleForDepartment,
  type DepartmentRequestStatus,
  type InboxDepartmentId,
} from '@/lib/department/constants';
import type {
  DepartmentRequestDetail,
  DepartmentRequestSummary,
  TechnicianSession,
} from '@/types';

export interface DepartmentRequestDashboardProps {
  department: InboxDepartmentId;
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
}

type Mode = 'list' | 'create' | 'detail';

type LineDraft = {
  partNumber: string;
  description: string;
  qty: number;
  status: string;
  vendor: string;
  notes: string;
};

const emptyLine = (): LineDraft => ({
  partNumber: '',
  description: '',
  qty: 1,
  status: 'requested',
  vendor: '',
  notes: '',
});

export function DepartmentRequestDashboard({
  department,
  session,
  onOpenSettings,
  onLogout,
  onBack,
}: DepartmentRequestDashboardProps) {
  const label = DEPARTMENT_LABELS[department];
  const isParts = department === 'parts';
  const Icon = department === 'parts' ? Package : department === 'sales' ? Briefcase : Wrench;

  const [mode, setMode] = useState<Mode>('list');
  const [requests, setRequests] = useState<DepartmentRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | DepartmentRequestStatus>('all');
  const [selected, setSelected] = useState<DepartmentRequestDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [moduleDisabled, setModuleDisabled] = useState(false);

  // create / edit fields
  const [subject, setSubject] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState('normal');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [vin, setVin] = useState('');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [stockOrRoHint, setStockOrRoHint] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupNote, setLookupNote] = useState('');

  const refreshList = useCallback(async () => {
    setLoading(true);
    setModuleDisabled(false);
    try {
      const data = await api.listDepartmentRequests({ department });
      setRequests(data.requests);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : `Failed to load ${label} inbox`;
      if (/module|not enabled|MODULE_DISABLED/i.test(msg)) {
        setModuleDisabled(true);
      }
      toast.error(msg);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [department, label]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const resetForm = () => {
    setSubject('');
    setSummary('');
    setPriority('normal');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setVin('');
    setVehicleLabel('');
    setStockOrRoHint('');
    setLines([emptyLine()]);
    setLookupQuery('');
    setLookupNote('');
  };

  const openCreate = () => {
    resetForm();
    setSelected(null);
    setMode('create');
  };

  const openDetail = async (id: string) => {
    setBusy(true);
    try {
      const { request } = await api.getDepartmentRequest(id);
      setSelected(request);
      setSubject(request.subject);
      setSummary(request.summary);
      setPriority(request.priority);
      setCustomerName(request.customerName);
      setCustomerPhone(request.customerPhone);
      setCustomerEmail(request.customerEmail);
      setVin(request.vin);
      setVehicleLabel(request.vehicleLabel || '');
      setStockOrRoHint(request.stockOrRoHint || '');
      setLines(
        request.partsLines.length > 0
          ? request.partsLines.map((l) => ({
              partNumber: l.partNumber || '',
              description: l.description,
              qty: l.qty,
              status: l.status,
              vendor: l.vendor || '',
              notes: l.notes || '',
            }))
          : [emptyLine()]
      );
      setMode('detail');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not open request');
    } finally {
      setBusy(false);
    }
  };

  const createRequest = async () => {
    if (!subject.trim()) {
      toast.error('Subject is required');
      return;
    }
    setBusy(true);
    try {
      const { request } = await api.createDepartmentRequest({
        department,
        subject: subject.trim(),
        summary: summary.trim() || undefined,
        priority,
        source: 'manual',
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        vin: vin.trim() || undefined,
        vehicleLabel: vehicleLabel.trim() || undefined,
        stockOrRoHint: stockOrRoHint.trim() || undefined,
        partsLines: isParts
          ? lines
              .filter((l) => l.description.trim())
              .map((l) => ({
                partNumber: l.partNumber.trim() || undefined,
                description: l.description.trim(),
                qty: l.qty,
                status: l.status,
                vendor: l.vendor.trim() || undefined,
                notes: l.notes.trim() || undefined,
              }))
          : undefined,
      });
      toast.success(`${label} request created`);
      setSelected(request);
      setMode('detail');
      void refreshList();
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
      const { request } = await api.patchDepartmentRequest(selected.id, {
        subject: subject.trim(),
        summary,
        priority,
        status: selected.status,
        customerName,
        customerPhone,
        customerEmail,
        vin,
        vehicleLabel,
        stockOrRoHint,
      });
      if (isParts) {
        await api.putPartsRequestLines(
          selected.id,
          lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              partNumber: l.partNumber.trim() || null,
              description: l.description.trim(),
              qty: l.qty,
              status: l.status,
              vendor: l.vendor.trim() || null,
              notes: l.notes.trim() || undefined,
            }))
        );
      }
      const refreshed = await api.getDepartmentRequest(selected.id);
      setSelected(refreshed.request);
      toast.success('Request saved');
      void refreshList();
      void request;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const { request } = await api.patchDepartmentRequest(selected.id, { status });
      setSelected(request);
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Status update failed');
    } finally {
      setBusy(false);
    }
  };

  const addLookup = async () => {
    if (!selected || !lookupQuery.trim()) return;
    setBusy(true);
    try {
      await api.addPartsLookup(selected.id, {
        query: lookupQuery.trim(),
        result: lookupNote.trim() ? { note: lookupNote.trim() } : {},
        source: 'staff',
      });
      const refreshed = await api.getDepartmentRequest(selected.id);
      setSelected(refreshed.request);
      setLookupQuery('');
      setLookupNote('');
      toast.success('Lookup logged');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const formFields = (
    <div className="space-y-4">
      <div>
        <label className="benz-label">Subject *</label>
        <input
          className="benz-input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What does the customer need?"
        />
      </div>
      <div>
        <label className="benz-label">Details</label>
        <textarea
          className="benz-textarea min-h-[100px]"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Call notes, part description, urgency…"
        />
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
        <div>
          <label className="benz-label">Email</label>
          <input
            className="benz-input"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="benz-label">Priority</label>
          <select
            className="benz-input"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            {DEPARTMENT_REQUEST_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="benz-label">Vehicle</label>
          <input
            className="benz-input"
            value={vehicleLabel}
            onChange={(e) => setVehicleLabel(e.target.value)}
            placeholder="Year make model"
          />
        </div>
        <div>
          <label className="benz-label">VIN</label>
          <input
            className="benz-input font-mono uppercase"
            value={vin}
            onChange={(e) => setVin(e.target.value.toUpperCase())}
            maxLength={17}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="benz-label">RO / stock hint</label>
          <input
            className="benz-input"
            value={stockOrRoHint}
            onChange={(e) => setStockOrRoHint(e.target.value)}
            placeholder="RO# or stock number (optional)"
          />
        </div>
      </div>

      {isParts ? (
        <div className="benz-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="font-semibold text-sm flex items-center gap-2">
              <Package size={16} /> Parts lines
            </div>
            <button
              type="button"
              className="secondary-btn h-9 px-3 text-xs"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              <Plus size={14} className="inline mr-1" /> Add line
            </button>
          </div>
          <ul className="space-y-3">
            {lines.map((line, index) => (
              <li key={index} className="rounded-lg border border-benz-border/60 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    className="benz-input text-sm"
                    placeholder="Part #"
                    value={line.partNumber}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, partNumber: e.target.value } : l
                        )
                      )
                    }
                  />
                  <input
                    className="benz-input text-sm sm:col-span-2"
                    placeholder="Description *"
                    value={line.description}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, description: e.target.value } : l
                        )
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    className="benz-input text-sm w-20"
                    value={line.qty}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, qty: Number(e.target.value) || 1 } : l
                        )
                      )
                    }
                  />
                  <select
                    className="benz-input text-sm"
                    value={line.status}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, status: e.target.value } : l
                        )
                      )
                    }
                  >
                    {PARTS_LINE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <input
                    className="benz-input text-sm flex-1 min-w-[8rem]"
                    placeholder="Vendor"
                    value={line.vendor}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, vendor: e.target.value } : l
                        )
                      )
                    }
                  />
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      className="text-benz-secondary"
                      aria-label="Remove line"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>
                <input
                  className="benz-input text-sm"
                  placeholder="Line notes"
                  value={line.notes}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, notes: e.target.value } : l))
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
          <Icon size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-benz-primary">{label}</span>
          <span className="truncate">· {session.dealershipName}</span>
          <span className="truncate">· {session.name}</span>
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
        <ModuleDisabledNotice
          title={`${label} inbox`}
          moduleId={moduleForDepartment(department) || department}
          hint={`Enable “${INBOX_MODULE_HINT[department]}” to open this inbox.`}
        />
      ) : mode === 'list' ? (
        <DepartmentInbox
          department={department}
          requests={requests}
          loading={loading}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onSelect={(id) => void openDetail(id)}
          onCreate={openCreate}
          emptyLabel={INBOX_EMPTY_COPY[department]}
        />
      ) : mode === 'create' ? (
        <div>
          <button
            type="button"
            className="benz-nav-back"
            onClick={() => setMode('list')}
            disabled={busy}
          >
            <ArrowLeft size={18} /> Back
          </button>
          <h2 className="benz-page-title mb-4">New {label.toLowerCase()} request</h2>
          {formFields}
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              className="primary-btn h-11 px-4"
              disabled={busy}
              onClick={() => void createRequest()}
            >
              {busy ? 'Saving…' : 'Create request'}
            </button>
            <button
              type="button"
              className="secondary-btn h-11 px-4"
              disabled={busy}
              onClick={() => setMode('list')}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : selected ? (
        <div>
          <button
            type="button"
            className="benz-nav-back"
            onClick={() => {
              setMode('list');
              setSelected(null);
            }}
            disabled={busy}
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <h2 className="benz-page-title">Request detail</h2>
            <select
              className="benz-input text-sm w-auto"
              value={selected.status}
              disabled={busy}
              onChange={(e) => {
                setSelected({ ...selected, status: e.target.value });
                void updateStatus(e.target.value);
              }}
            >
              {DEPARTMENT_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          {formFields}

          {isParts ? (
            <div className="benz-card p-4 mt-4 space-y-3">
              <div className="font-semibold text-sm">Parts lookup history</div>
              {selected.partsLookups.length === 0 ? (
                <p className="text-xs text-benz-secondary">No lookups logged yet.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {selected.partsLookups.map((lu) => (
                    <li key={lu.id} className="border-b border-benz-border/40 pb-2">
                      <div className="font-medium">{lu.query}</div>
                      <div className="text-benz-secondary mt-0.5">
                        {lu.createdByName || 'Staff'} · {new Date(lu.createdAt).toLocaleString()} ·{' '}
                        {lu.source}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className="benz-input text-sm"
                  placeholder="Lookup query (part #, description…)"
                  value={lookupQuery}
                  onChange={(e) => setLookupQuery(e.target.value)}
                />
                <input
                  className="benz-input text-sm"
                  placeholder="Result note (optional)"
                  value={lookupNote}
                  onChange={(e) => setLookupNote(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="secondary-btn h-10 px-3 text-xs"
                disabled={busy || !lookupQuery.trim()}
                onClick={() => void addLookup()}
              >
                Log lookup
              </button>
            </div>
          ) : selected.source === 'voice_agent' ? (
            <p className="text-xs text-benz-secondary mt-3">
              Created by voice agent — customer details and notes are above. Update status as you
              work the lead.
            </p>
          ) : null}

          <div className="flex gap-2 mt-4">
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
