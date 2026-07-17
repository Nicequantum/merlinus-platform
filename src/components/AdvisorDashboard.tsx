'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardList,
  LogOut,
  Settings,
  Video,
} from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { hasSoldMetrics } from '@/lib/repairLineSoldMetrics';
import type { RepairLineSoldMetrics, RepairOrder, RepairOrderSummary, TechnicianSession } from '@/types';

interface AdvisorDashboardProps {
  session: TechnicianSession;
  onOpenSettings: () => void;
  onOpenVideoInspection?: () => void;
  onLogout: () => Promise<void>;
}

function formatVehicle(ro: RepairOrder | RepairOrderSummary) {
  return [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

function emptySoldMetrics(): RepairLineSoldMetrics {
  return {
    soldLaborHours: null,
    soldLaborAmount: null,
    soldPartsAmount: null,
    customerApproved: null,
    isAddOn: null,
    soldMetricsUpdatedAt: null,
  };
}

function SoldMetricsForm({
  roId,
  lineId,
  lineNumber,
  description,
  initialMetrics,
  onSaved,
}: {
  roId: string;
  lineId: string;
  lineNumber: number;
  description: string;
  initialMetrics: RepairLineSoldMetrics;
  onSaved: (metrics: RepairLineSoldMetrics) => void;
}) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setMetrics(initialMetrics);
    setSaved(false);
  }, [initialMetrics, lineId]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { soldMetrics } = await api.saveRepairLineSoldMetrics(roId, lineId, {
        soldLaborHours: metrics.soldLaborHours,
        soldLaborAmount: metrics.soldLaborAmount,
        soldPartsAmount: metrics.soldPartsAmount,
        customerApproved: metrics.customerApproved,
        isAddOn: metrics.isAddOn,
      });
      onSaved(soldMetrics);
      setSaved(true);
      toast.success(`Line ${lineNumber} saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save sold metrics');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="benz-card p-4 space-y-3">
      <div>
        <div className="text-xs font-semibold text-benz-blue uppercase tracking-wide">
          Line {lineNumber}
        </div>
        <div className="text-sm mt-1 leading-snug">{description}</div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <label className="space-y-1">
          <span className="text-xs text-benz-secondary">Sold labor hours</span>
          <input
            type="number"
            min={0}
            step="0.1"
            inputMode="decimal"
            value={metrics.soldLaborHours ?? ''}
            onChange={(e) =>
              setMetrics((prev) => ({
                ...prev,
                soldLaborHours: e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            className="benz-input"
            placeholder="0.0"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-benz-secondary">Sold labor ($)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={metrics.soldLaborAmount ?? ''}
            onChange={(e) =>
              setMetrics((prev) => ({
                ...prev,
                soldLaborAmount: e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            className="benz-input"
            placeholder="0.00"
          />
        </label>
        <label className="space-y-1 col-span-2">
          <span className="text-xs text-benz-secondary">Sold parts ($)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={metrics.soldPartsAmount ?? ''}
            onChange={(e) =>
              setMetrics((prev) => ({
                ...prev,
                soldPartsAmount: e.target.value === '' ? null : Number(e.target.value),
              }))
            }
            className="benz-input"
            placeholder="0.00"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMetrics((prev) => ({ ...prev, customerApproved: true }))}
          className={`secondary-btn h-10 text-xs ${metrics.customerApproved === true ? 'benz-btn-accent-outline' : ''}`}
        >
          Customer approved
        </button>
        <button
          type="button"
          onClick={() => setMetrics((prev) => ({ ...prev, customerApproved: false }))}
          className={`secondary-btn h-10 text-xs ${metrics.customerApproved === false ? 'benz-btn-accent-outline' : ''}`}
        >
          Not approved
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMetrics((prev) => ({ ...prev, isAddOn: true }))}
          className={`secondary-btn h-10 text-xs ${metrics.isAddOn === true ? 'benz-btn-accent-outline' : ''}`}
        >
          Add-on / upsell
        </button>
        <button
          type="button"
          onClick={() => setMetrics((prev) => ({ ...prev, isAddOn: false }))}
          className={`secondary-btn h-10 text-xs ${metrics.isAddOn === false ? 'benz-btn-accent-outline' : ''}`}
        >
          Original line
        </button>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="primary-btn w-full h-11 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saved ? <Check size={16} /> : null}
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save line metrics'}
      </button>
    </div>
  );
}

export function AdvisorDashboard({
  session,
  onOpenSettings,
  onOpenVideoInspection,
  onLogout,
}: AdvisorDashboardProps) {
  const [repairOrders, setRepairOrders] = useState<RepairOrderSummary[]>([]);
  const [selectedRoId, setSelectedRoId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepairOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadRepairOrders = useCallback(async () => {
    setLoading(true);
    try {
      const { repairOrders: list } = await api.listRepairOrders({ scope: 'today' });
      setRepairOrders(list);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load your repair orders');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (roId: string) => {
    setDetailLoading(true);
    try {
      const { repairOrder } = await api.getRepairOrder(roId);
      setDetail(repairOrder);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load repair order');
      setSelectedRoId(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRepairOrders();
  }, [loadRepairOrders]);

  useEffect(() => {
    if (selectedRoId) {
      void loadDetail(selectedRoId);
    } else {
      setDetail(null);
    }
  }, [selectedRoId, loadDetail]);

  const selectedSummary = repairOrders.find((ro) => ro.id === selectedRoId);

  const handleLogout = async () => {
    try {
      await onLogout();
      toast.success('Signed out');
    } catch {
      toast.error('Logout failed');
    }
  };

  return (
    <div className="benz-page-compact">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => {
            if (selectedRoId) {
              setSelectedRoId(null);
              return;
            }
          }}
          className={`benz-icon-btn -ml-1 touch-target text-benz-blue ${selectedRoId ? '' : 'invisible'}`}
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="benz-dashboard-eyebrow text-left mb-0.5">Service Advisor</div>
          <h1 className="text-xl font-bold tracking-tight truncate">
            {selectedSummary ? `RO ${selectedSummary.roNumber}` : 'My Repair Orders'}
          </h1>
          <p className="text-xs text-benz-secondary mt-0.5 leading-snug">
            {selectedSummary
              ? formatVehicle(selectedSummary)
              : `Welcome, ${session.name} — capture sold metrics in seconds`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onOpenVideoInspection ? (
            <button
              type="button"
              onClick={onOpenVideoInspection}
              className="benz-icon-btn touch-target text-benz-blue"
              aria-label="Video Inspection"
              title="Video Inspection"
            >
              <Video size={20} />
            </button>
          ) : null}
          <button
            onClick={onOpenSettings}
            className="benz-icon-btn touch-target text-benz-blue"
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={handleLogout}
            className="benz-icon-btn touch-target text-benz-secondary"
            aria-label="Sign out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="benz-card p-6 text-sm text-benz-secondary">Loading your repair orders…</div>
      ) : selectedRoId ? (
        detailLoading || !detail ? (
          <div className="benz-card p-6 text-sm text-benz-secondary">Loading repair order…</div>
        ) : (
          <div className="space-y-3">
            <div className="benz-card p-4 benz-alert-info border">
              <div className="flex items-center gap-2 text-sm font-medium text-benz-blue mb-1">
                <ClipboardList size={16} />
                Sold metrics
              </div>
              <p className="text-xs text-benz-secondary leading-relaxed">
                Saved directly to each repair line — visible to technicians and managers on this RO.
              </p>
            </div>
            {detail.repairLines.map((line) => (
              <SoldMetricsForm
                key={line.id}
                roId={detail.id}
                lineId={line.id}
                lineNumber={line.lineNumber}
                description={line.description}
                initialMetrics={line.soldMetrics ?? emptySoldMetrics()}
                onSaved={(soldMetrics) => {
                  setDetail((prev) =>
                    prev
                      ? {
                          ...prev,
                          repairLines: prev.repairLines.map((item) =>
                            item.id === line.id ? { ...item, soldMetrics } : item
                          ),
                        }
                      : prev
                  );
                }}
              />
            ))}
          </div>
        )
      ) : repairOrders.length === 0 ? (
        <BenzEmptyState
          icon={ClipboardList}
          title="No active repair orders"
          hint="Repair orders linked to you will appear here after technicians scan RO paperwork with your name."
        />
      ) : (
        <div className="space-y-2.5">
          {repairOrders.map((ro) => {
            const metricsCaptured = ro.repairLines.filter((line) =>
              hasSoldMetrics(line.soldMetrics)
            ).length;

            return (
              <button
                key={ro.id}
                onClick={() => setSelectedRoId(ro.id)}
                className="benz-settings-nav"
              >
                <div className="min-w-0 text-left flex-1">
                  <div className="font-semibold text-sm truncate">RO {ro.roNumber}</div>
                  <div className="text-xs text-benz-secondary mt-1">{formatVehicle(ro)}</div>
                  <div className="text-xs text-benz-muted">
                    {ro.repairLines.length} line{ro.repairLines.length === 1 ? '' : 's'} ·{' '}
                    {metricsCaptured} captured
                  </div>
                </div>
                <ChevronRight size={18} className="text-benz-secondary shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}