'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Car, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { ModuleDisabledNotice } from '@/components/modules/ModuleDisabledNotice';
import { DepartmentVoicePanel } from '@/components/voice/DepartmentVoicePanel';
import { effectiveRole } from '@/lib/apex/viewAs';
import {
  canManageLoanerFleet,
  FUEL_LEVELS,
  LOANER_ASSIGNMENT_STATUS_LABELS,
  LOANER_VEHICLE_STATUS_LABELS,
  LOANER_VEHICLE_STATUSES,
  type LoanerVehicleStatus,
} from '@/lib/loaner/constants';
import type { TechnicianSession } from '@/types';

interface LoanerDashboardProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onBack?: () => void;
}

type VehicleDto = {
  id: string;
  unitNumber: string;
  vin: string;
  vinLast8: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vehicleLabel: string | null;
  plate: string;
  color: string | null;
  odometer: number;
  status: string;
  notes: string;
};

type AssignmentDto = {
  id: string;
  loanerVehicleId: string;
  unitNumber: string | null;
  vehicleLabel: string | null;
  customerName: string;
  customerPhone: string;
  customerPhoneLast4: string | null;
  status: string;
  checkoutAt: string | null;
  dueBackAt: string | null;
  returnedAt: string | null;
  outOdometer: number | null;
  inOdometer: number | null;
  fuelOut: string | null;
  fuelIn: string | null;
  damageOut: Array<{ area: string; note?: string; severity?: string }>;
  damageIn: Array<{ area: string; note?: string; severity?: string }>;
  notes: string;
};

type Mode = 'fleet' | 'add-vehicle' | 'assign' | 'assignment-detail';

function statusColor(status: string): string {
  switch (status) {
    case 'available':
      return 'bg-emerald-500 text-white';
    case 'reserved':
      return 'bg-amber-400 text-black';
    case 'out':
    case 'active':
      return 'bg-sky-600 text-white';
    case 'maintenance':
      return 'bg-orange-500 text-white';
    case 'out_of_service':
    case 'cancelled':
      return 'bg-slate-400 text-white';
    case 'returned':
      return 'bg-emerald-700 text-white';
    default:
      return 'bg-slate-300 text-slate-800';
  }
}

export function LoanerDashboard({
  session,
  onOpenSettings,
  onLogout,
  onBack,
}: LoanerDashboardProps) {
  const role = effectiveRole(session);
  const canManage = canManageLoanerFleet(role);

  const [mode, setMode] = useState<Mode>('fleet');
  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [assignments, setAssignments] = useState<AssignmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleDisabled, setModuleDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | LoanerVehicleStatus>('all');
  const [selectedAssignment, setSelectedAssignment] = useState<AssignmentDto | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  // add vehicle form
  const [unitNumber, setUnitNumber] = useState('');
  const [vin, setVin] = useState('');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [plate, setPlate] = useState('');
  const [color, setColor] = useState('');
  const [odometer, setOdometer] = useState('0');
  const [vehicleNotes, setVehicleNotes] = useState('');

  // assign form
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [dueBackAt, setDueBackAt] = useState('');
  const [assignMode, setAssignMode] = useState<'reserve' | 'checkout'>('reserve');
  const [fuelOut, setFuelOut] = useState('F');
  const [outOdo, setOutOdo] = useState('');
  const [damageOutText, setDamageOutText] = useState('');
  const [assignNotes, setAssignNotes] = useState('');

  // return form
  const [fuelIn, setFuelIn] = useState('F');
  const [inOdo, setInOdo] = useState('');
  const [damageInText, setDamageInText] = useState('');
  const [returnVehicleStatus, setReturnVehicleStatus] = useState<
    'available' | 'maintenance' | 'out_of_service'
  >('available');

  const refresh = useCallback(async () => {
    setLoading(true);
    setModuleDisabled(false);
    try {
      const [v, a] = await Promise.all([
        api.listLoanerVehicles(),
        api.listLoanerAssignments({ open: true }),
      ]);
      setVehicles(v.vehicles as VehicleDto[]);
      setAssignments(a.assignments as AssignmentDto[]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load loaner fleet';
      if (/module|not enabled|MODULE_DISABLED/i.test(msg)) setModuleDisabled(true);
      toast.error(msg);
      setVehicles([]);
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredVehicles = useMemo(() => {
    if (statusFilter === 'all') return vehicles;
    return vehicles.filter((v) => v.status === statusFilter);
  }, [vehicles, statusFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: vehicles.length };
    for (const s of LOANER_VEHICLE_STATUSES) c[s] = 0;
    for (const v of vehicles) c[v.status] = (c[v.status] || 0) + 1;
    return c;
  }, [vehicles]);

  const resetVehicleForm = () => {
    setUnitNumber('');
    setVin('');
    setYear('');
    setMake('');
    setModel('');
    setPlate('');
    setColor('');
    setOdometer('0');
    setVehicleNotes('');
  };

  const resetAssignForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setDueBackAt('');
    setAssignMode('reserve');
    setFuelOut('F');
    setOutOdo('');
    setDamageOutText('');
    setAssignNotes('');
    setSelectedVehicleId(null);
  };

  const addVehicle = async () => {
    if (!unitNumber.trim()) {
      toast.error('Unit number is required');
      return;
    }
    setBusy(true);
    try {
      await api.createLoanerVehicle({
        unitNumber: unitNumber.trim(),
        vin: vin.trim() || undefined,
        year: year ? Number(year) : null,
        make: make.trim() || null,
        model: model.trim() || null,
        plate: plate.trim() || undefined,
        color: color.trim() || null,
        odometer: Number(odometer) || 0,
        notes: vehicleNotes.trim() || undefined,
      });
      toast.success('Loaner unit added');
      resetVehicleForm();
      setMode('fleet');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add unit');
    } finally {
      setBusy(false);
    }
  };

  const parseDamage = (text: string) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [area, ...rest] = line.split(':');
        return { area: (area || line).trim(), note: rest.join(':').trim() || undefined };
      });

  const createAssignment = async () => {
    if (!selectedVehicleId) {
      toast.error('Select a vehicle');
      return;
    }
    setBusy(true);
    try {
      await api.createLoanerAssignment({
        loanerVehicleId: selectedVehicleId,
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        dueBackAt: dueBackAt ? new Date(dueBackAt).toISOString() : null,
        notes: assignNotes.trim() || undefined,
        mode: assignMode,
        outOdometer: outOdo ? Number(outOdo) : null,
        fuelOut: assignMode === 'checkout' ? fuelOut : null,
        damageOut: assignMode === 'checkout' ? parseDamage(damageOutText) : undefined,
      });
      toast.success(assignMode === 'checkout' ? 'Loaner checked out' : 'Loaner reserved');
      resetAssignForm();
      setMode('fleet');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Assignment failed');
    } finally {
      setBusy(false);
    }
  };

  const openAssignment = async (id: string) => {
    setBusy(true);
    try {
      const { assignment: raw } = await api.getLoanerAssignment(id);
      const assignment = raw as AssignmentDto;
      setSelectedAssignment(assignment);
      setInOdo(String(assignment.outOdometer ?? assignment.inOdometer ?? ''));
      setFuelIn(assignment.fuelIn || assignment.fuelOut || 'F');
      setDamageInText('');
      setReturnVehicleStatus('available');
      setMode('assignment-detail');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not open assignment');
    } finally {
      setBusy(false);
    }
  };

  const checkoutSelected = async () => {
    if (!selectedAssignment) return;
    setBusy(true);
    try {
      const { assignment } = await api.patchLoanerAssignment(selectedAssignment.id, {
        action: 'checkout',
        outOdometer: outOdo ? Number(outOdo) : null,
        fuelOut,
        damageOut: parseDamage(damageOutText),
      });
      setSelectedAssignment(assignment as AssignmentDto);
      toast.success('Checked out');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setBusy(false);
    }
  };

  const returnSelected = async () => {
    if (!selectedAssignment) return;
    setBusy(true);
    try {
      const { assignment } = await api.patchLoanerAssignment(selectedAssignment.id, {
        action: 'return',
        inOdometer: inOdo ? Number(inOdo) : null,
        fuelIn,
        damageIn: parseDamage(damageInText),
        markVehicleStatus: returnVehicleStatus,
      });
      setSelectedAssignment(assignment as AssignmentDto);
      toast.success('Loaner returned');
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Return failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelSelected = async () => {
    if (!selectedAssignment) return;
    setBusy(true);
    try {
      await api.patchLoanerAssignment(selectedAssignment.id, { action: 'cancel' });
      toast.success('Reservation cancelled');
      setMode('fleet');
      setSelectedAssignment(null);
      void refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const availableVehicles = vehicles.filter((v) => v.status === 'available');

  return (
    <div className="benz-page">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2 text-sm text-benz-secondary min-w-0">
          {onBack ? (
            <button type="button" className="benz-nav-back !mb-0" onClick={onBack}>
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <Car size={18} className="text-benz-blue shrink-0" />
          <span className="font-semibold text-benz-primary">Loaner fleet</span>
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
        <ModuleDisabledNotice title="Loaner fleet" moduleId="loaner" />
      ) : mode === 'fleet' ? (
        <>
          <DepartmentVoicePanel department="loaner" className="mb-4" compact />
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="benz-dashboard-eyebrow">Availability & assignments</p>
              <h2 className="benz-page-title text-xl">Fleet board</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="primary-btn h-11 px-4"
                disabled={availableVehicles.length === 0}
                onClick={() => {
                  resetAssignForm();
                  setMode('assign');
                }}
              >
                Reserve / checkout
              </button>
              {canManage ? (
                <button
                  type="button"
                  className="secondary-btn h-11 px-4"
                  onClick={() => {
                    resetVehicleForm();
                    setMode('add-vehicle');
                  }}
                >
                  <Plus size={16} className="inline mr-1" /> Add unit
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              type="button"
              className={`h-9 px-3 rounded-full text-xs font-semibold border ${
                statusFilter === 'all'
                  ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
                  : 'border-benz-border/60 text-benz-secondary'
              }`}
              onClick={() => setStatusFilter('all')}
            >
              All ({counts.all || 0})
            </button>
            {LOANER_VEHICLE_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`h-9 px-3 rounded-full text-xs font-semibold border ${
                  statusFilter === s
                    ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
                    : 'border-benz-border/60 text-benz-secondary'
                }`}
                onClick={() => setStatusFilter(s)}
              >
                {LOANER_VEHICLE_STATUS_LABELS[s]} ({counts[s] || 0})
              </button>
            ))}
          </div>

          {loading ? (
            <p className="benz-hint flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Loading fleet…
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {filteredVehicles.map((v) => (
                  <div key={v.id} className="benz-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">Unit {v.unitNumber}</div>
                        <div className="text-xs text-benz-secondary mt-0.5">
                          {v.vehicleLabel || '—'}
                          {v.color ? ` · ${v.color}` : ''}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(v.status)}`}
                      >
                        {LOANER_VEHICLE_STATUS_LABELS[v.status as LoanerVehicleStatus] || v.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-benz-muted mt-2">
                      {v.vinLast8 ? `VIN …${v.vinLast8}` : 'No VIN'}
                      {v.plate ? ` · ${v.plate}` : ''} · {v.odometer.toLocaleString()} mi
                    </div>
                    {v.status === 'available' ? (
                      <button
                        type="button"
                        className="secondary-btn h-9 px-3 text-xs mt-3 w-full"
                        onClick={() => {
                          resetAssignForm();
                          setSelectedVehicleId(v.id);
                          setOutOdo(String(v.odometer));
                          setMode('assign');
                        }}
                      >
                        Assign
                      </button>
                    ) : null}
                  </div>
                ))}
                {filteredVehicles.length === 0 ? (
                  <p className="benz-hint sm:col-span-2">No units in this filter.</p>
                ) : null}
              </div>

              <div className="benz-card p-4">
                <div className="font-semibold text-sm mb-3">Open assignments</div>
                {assignments.length === 0 ? (
                  <p className="text-xs text-benz-secondary">No active reservations or checkouts.</p>
                ) : (
                  <ul className="space-y-2">
                    {assignments.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          className="w-full text-left rounded-lg border border-benz-border/50 px-3 py-2.5 hover:border-benz-blue/40"
                          onClick={() => void openAssignment(a.id)}
                        >
                          <div className="flex justify-between gap-2">
                            <span className="text-sm font-semibold">
                              Unit {a.unitNumber} · {a.customerName || 'Customer'}
                            </span>
                            <span
                              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(a.status)}`}
                            >
                              {LOANER_ASSIGNMENT_STATUS_LABELS[
                                a.status as keyof typeof LOANER_ASSIGNMENT_STATUS_LABELS
                              ] || a.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-benz-secondary mt-0.5">
                            {a.vehicleLabel || '—'}
                            {a.dueBackAt
                              ? ` · due ${new Date(a.dueBackAt).toLocaleString()}`
                              : ''}
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
      ) : mode === 'add-vehicle' ? (
        <div className="max-w-xl">
          <button type="button" className="benz-nav-back" onClick={() => setMode('fleet')}>
            <ArrowLeft size={18} /> Back
          </button>
          <h2 className="benz-page-title mb-4">Add loaner unit</h2>
          <div className="space-y-3">
            <div>
              <label className="benz-label">Unit number *</label>
              <input
                className="benz-input"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
                placeholder="L1"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="benz-input"
                placeholder="Year"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
              <input
                className="benz-input"
                placeholder="Make"
                value={make}
                onChange={(e) => setMake(e.target.value)}
              />
              <input
                className="benz-input"
                placeholder="Model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <input
              className="benz-input font-mono uppercase"
              placeholder="VIN"
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              maxLength={17}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className="benz-input"
                placeholder="Plate"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
              />
              <input
                className="benz-input"
                placeholder="Color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <input
                className="benz-input"
                placeholder="Odometer"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
            </div>
            <textarea
              className="benz-textarea min-h-[80px]"
              placeholder="Notes"
              value={vehicleNotes}
              onChange={(e) => setVehicleNotes(e.target.value)}
            />
            <button
              type="button"
              className="primary-btn h-11 px-4"
              disabled={busy}
              onClick={() => void addVehicle()}
            >
              {busy ? 'Saving…' : 'Add unit'}
            </button>
          </div>
        </div>
      ) : mode === 'assign' ? (
        <div className="max-w-xl">
          <button type="button" className="benz-nav-back" onClick={() => setMode('fleet')}>
            <ArrowLeft size={18} /> Back
          </button>
          <h2 className="benz-page-title mb-4">Reserve / checkout</h2>
          <div className="space-y-3">
            <div>
              <label className="benz-label">Vehicle *</label>
              <select
                className="benz-input"
                value={selectedVehicleId || ''}
                onChange={(e) => {
                  setSelectedVehicleId(e.target.value || null);
                  const v = vehicles.find((x) => x.id === e.target.value);
                  if (v) setOutOdo(String(v.odometer));
                }}
              >
                <option value="">Select available unit…</option>
                {availableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.unitNumber} — {v.vehicleLabel || 'unit'} ({v.odometer.toLocaleString()} mi)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                className="benz-input"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <input
                className="benz-input"
                placeholder="Phone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
            </div>
            <div>
              <label className="benz-label">Due back</label>
              <input
                type="datetime-local"
                className="benz-input"
                value={dueBackAt}
                onChange={(e) => setDueBackAt(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={`secondary-btn h-10 px-3 text-xs ${assignMode === 'reserve' ? 'ring-2 ring-benz-blue' : ''}`}
                onClick={() => setAssignMode('reserve')}
              >
                Reserve only
              </button>
              <button
                type="button"
                className={`secondary-btn h-10 px-3 text-xs ${assignMode === 'checkout' ? 'ring-2 ring-benz-blue' : ''}`}
                onClick={() => setAssignMode('checkout')}
              >
                Check out now
              </button>
            </div>
            {assignMode === 'checkout' ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="benz-input"
                    placeholder="Out odometer"
                    value={outOdo}
                    onChange={(e) => setOutOdo(e.target.value)}
                  />
                  <select
                    className="benz-input"
                    value={fuelOut}
                    onChange={(e) => setFuelOut(e.target.value)}
                  >
                    {FUEL_LEVELS.map((f) => (
                      <option key={f} value={f}>
                        Fuel out: {f}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="benz-textarea min-h-[72px]"
                  placeholder="Damage at checkout (one per line: Area: note)"
                  value={damageOutText}
                  onChange={(e) => setDamageOutText(e.target.value)}
                />
              </>
            ) : null}
            <textarea
              className="benz-textarea min-h-[64px]"
              placeholder="Notes"
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
            />
            <button
              type="button"
              className="primary-btn h-11 px-4"
              disabled={busy}
              onClick={() => void createAssignment()}
            >
              {busy ? 'Saving…' : assignMode === 'checkout' ? 'Check out' : 'Reserve'}
            </button>
          </div>
        </div>
      ) : selectedAssignment ? (
        <div className="max-w-xl">
          <button type="button" className="benz-nav-back" onClick={() => setMode('fleet')}>
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <h2 className="benz-page-title">Assignment</h2>
            <span
              className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${statusColor(selectedAssignment.status)}`}
            >
              {selectedAssignment.status}
            </span>
          </div>
          <p className="text-sm text-benz-secondary mb-4">
            Unit {selectedAssignment.unitNumber} · {selectedAssignment.vehicleLabel || '—'}
            <br />
            {selectedAssignment.customerName || 'Customer'}
            {selectedAssignment.customerPhoneLast4
              ? ` · …${selectedAssignment.customerPhoneLast4}`
              : ''}
          </p>

          {selectedAssignment.status === 'reserved' ? (
            <div className="space-y-3 benz-card p-4 mb-4">
              <div className="font-semibold text-sm">Checkout</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="benz-input"
                  placeholder="Out odometer"
                  value={outOdo}
                  onChange={(e) => setOutOdo(e.target.value)}
                />
                <select
                  className="benz-input"
                  value={fuelOut}
                  onChange={(e) => setFuelOut(e.target.value)}
                >
                  {FUEL_LEVELS.map((f) => (
                    <option key={f} value={f}>
                      Fuel: {f}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="benz-textarea min-h-[64px]"
                placeholder="Damage out (Area: note)"
                value={damageOutText}
                onChange={(e) => setDamageOutText(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="primary-btn h-10 px-3 text-xs"
                  disabled={busy}
                  onClick={() => void checkoutSelected()}
                >
                  Check out
                </button>
                <button
                  type="button"
                  className="secondary-btn h-10 px-3 text-xs"
                  disabled={busy}
                  onClick={() => void cancelSelected()}
                >
                  Cancel reservation
                </button>
              </div>
            </div>
          ) : null}

          {selectedAssignment.status === 'active' || selectedAssignment.status === 'reserved' ? (
            <div className="space-y-3 benz-card p-4">
              <div className="font-semibold text-sm">Return</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="benz-input"
                  placeholder="In odometer"
                  value={inOdo}
                  onChange={(e) => setInOdo(e.target.value)}
                />
                <select
                  className="benz-input"
                  value={fuelIn}
                  onChange={(e) => setFuelIn(e.target.value)}
                >
                  {FUEL_LEVELS.map((f) => (
                    <option key={f} value={f}>
                      Fuel in: {f}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                className="benz-textarea min-h-[64px]"
                placeholder="Damage in (Area: note)"
                value={damageInText}
                onChange={(e) => setDamageInText(e.target.value)}
              />
              <select
                className="benz-input"
                value={returnVehicleStatus}
                onChange={(e) =>
                  setReturnVehicleStatus(
                    e.target.value as 'available' | 'maintenance' | 'out_of_service'
                  )
                }
              >
                <option value="available">Return to available</option>
                <option value="maintenance">Send to maintenance</option>
                <option value="out_of_service">Mark out of service</option>
              </select>
              <button
                type="button"
                className="primary-btn h-10 px-3 text-xs"
                disabled={busy}
                onClick={() => void returnSelected()}
              >
                Complete return
              </button>
            </div>
          ) : null}

          {selectedAssignment.status === 'returned' ? (
            <p className="text-sm text-benz-secondary">
              Returned {selectedAssignment.returnedAt
                ? new Date(selectedAssignment.returnedAt).toLocaleString()
                : ''}
              {selectedAssignment.inOdometer != null
                ? ` · ${selectedAssignment.inOdometer.toLocaleString()} mi`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
