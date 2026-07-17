'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ClipboardList,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  Video,
} from 'lucide-react';
import Link from 'next/link';
import { DealershipBranding } from '@/components/DealershipBranding';
import { ScanROSection } from '@/components/ScanROSection';
import type { PendingImage } from '@/types';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DashboardSummary, RepairOrder, TechnicianSession } from '@/types';

interface ManagerDashboardProps {
  session: TechnicianSession;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  openingROId: string | null;
  onOpenRO: (target: RepairOrder | string) => void;
  onOpenSettings: () => void;
  onOpenAuditLogs: () => void;
  onOpenServiceAdvisors: () => void;
  onOpenTechnicians: () => void;
  onOpenVideoInspection?: () => void;
  pendingROImages: PendingImage[];
  onScanRO: () => void;
  onAddFromGallery: () => void;
  onProcessScan: () => void;
  onClearPendingScan: () => void;
  onCancelScan: () => void;
  onDeletePendingPage?: (imageId: string) => void;
  onCreateManualRO: () => void;
  isProcessingOCR: boolean;
  ocrProgress: number;
  scanStatusMessage: string;
  children: React.ReactNode;
}

function StatCard({
  label,
  value,
  icon,
  accent = 'text-benz-blue',
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="stat-card p-4 sm:p-5">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider text-benz-secondary mb-2.5 ${accent}`}>
        {icon}
        {label}
      </div>
      <div className="text-2xl sm:text-[1.75rem] font-bold tracking-tight">{value}</div>
    </div>
  );
}

export function ManagerDashboard({
  session,
  searchTerm,
  onSearchChange,
  openingROId,
  onOpenRO,
  onOpenSettings,
  onOpenAuditLogs,
  onOpenServiceAdvisors,
  onOpenTechnicians,
  onOpenVideoInspection,
  pendingROImages,
  onScanRO,
  onAddFromGallery,
  onProcessScan,
  onClearPendingScan,
  onCancelScan,
  onDeletePendingPage,
  onCreateManualRO,
  isProcessingOCR,
  ocrProgress,
  scanStatusMessage,
  children,
}: ManagerDashboardProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDashboardSummary();
      setSummary(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const chain = summary?.audit?.chain;
  const isAdmin = session.isAdmin;

  return (
    <div className="benz-dashboard-layout benz-page-compact">
      <div className="relative pt-2 mb-6 md:mb-8">
        <button
          onClick={onOpenSettings}
          className="absolute top-2 right-0 benz-icon-btn touch-target"
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>
        <p className="benz-dashboard-eyebrow">Manager Dashboard</p>
        <DealershipBranding size="md" displayName={session.dealershipName} />
        <p className="text-xs text-benz-secondary mt-3 text-center">Signed in as {session.name}</p>
      </div>

      {loading ? (
        <div className="benz-card p-8 text-sm text-benz-secondary text-center mb-5">Loading dealership metrics…</div>
      ) : summary ? (
        <div className="benz-dashboard-grid">
          <section className="benz-dashboard-overview">
            <div className="benz-dashboard-stats grid grid-cols-2 gap-3">
              <StatCard label="Repair Orders" value={summary.stats.totalRepairOrders} icon={<ClipboardList size={14} />} />
              <StatCard
                label="Warranty Stories"
                value={summary.stats.warrantyStories}
                icon={<Sparkles size={14} />}
                accent="text-benz-green"
              />
              <StatCard label="Active Techs" value={summary.stats.activeTechnicians} icon={<Users size={14} />} />
              <StatCard
                label="Audit Events (7d)"
                value={summary.stats.auditEventsThisWeek}
                icon={<Activity size={14} />}
                accent="text-benz-amber"
              />
            </div>

            <div className="benz-card p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className={`benz-avatar ${chain?.valid ? 'text-benz-green' : 'text-benz-amber'}`}>
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm tracking-tight">Audit Chain Integrity</div>
                    <div className="benz-hint mt-0.5">SHA-256 hash chain per dealership</div>
                  </div>
                </div>
                <span className={`status-pill ${chain?.valid ? 'status-pill-valid' : 'status-pill-warn'}`}>
                  {chain?.valid ? 'Valid' : 'Review'}
                </span>
              </div>
              <p className="text-xs text-benz-secondary leading-relaxed mb-4">
                {chain?.description}
                {chain && chain.legacyEntries > 0
                  ? ` ${chain.legacyEntries} legacy entr${chain.legacyEntries === 1 ? 'y' : 'ies'} pre-date the hash chain.`
                  : ''}
              </p>
              <div className="benz-dashboard-nav-row">
                {isAdmin && (
                  <Link
                    href="/admin/usage"
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <BarChart3 size={14} /> Usage
                  </Link>
                )}
                {onOpenVideoInspection ? (
                  <button
                    type="button"
                    onClick={onOpenVideoInspection}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Video size={14} /> Video Inspection
                  </button>
                ) : null}
                <button
                  onClick={onOpenServiceAdvisors}
                  className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <UserRound size={14} /> Advisors
                </button>
                <button
                  onClick={onOpenTechnicians}
                  className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <Users size={14} /> Technicians
                </button>
                <button
                  onClick={onOpenAuditLogs}
                  className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <ScrollText size={14} /> Audit log
                </button>
              </div>
            </div>

            {summary.recentRepairOrders.length > 0 && (
              <div className="benz-card p-5">
                <div className="benz-section-title mb-4">Recent Shop Activity</div>
                <div className="space-y-2">
                  {summary.recentRepairOrders.map((ro) => {
                    const isOpening = openingROId === ro.id;
                    const isBusy = openingROId !== null;
                    return (
                      <button
                        key={ro.id}
                        type="button"
                        disabled={isBusy}
                        onClick={() => onOpenRO(ro.id)}
                        className={`w-full text-left benz-list-row px-4 py-3 touch-manipulation ${
                          isOpening
                            ? 'ring-2 ring-benz-accent/50 cursor-wait'
                            : isBusy
                              ? 'opacity-50 cursor-not-allowed'
                              : 'cursor-pointer'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold tracking-tight">{ro.roNumber}</span>
                          {isOpening ? (
                            <span className="text-xs font-semibold text-benz-blue">Loading…</span>
                          ) : (
                            ro.hasStories && (
                              <span className="text-xs font-semibold text-benz-green">Story</span>
                            )
                          )}
                        </div>
                        <div className="text-xs text-benz-secondary mt-1">
                          {[ro.year, ro.make, ro.model].filter(Boolean).join(' ')} · {ro.technicianName}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="benz-dashboard-workspace">
            <ScanROSection
              pendingROImages={pendingROImages}
              isProcessingOCR={isProcessingOCR}
              ocrProgress={ocrProgress}
              scanStatusMessage={scanStatusMessage}
              onScanRO={onScanRO}
              onAddFromGallery={onAddFromGallery}
              onProcessScan={onProcessScan}
              onClearPendingScan={onClearPendingScan}
              onCancelScan={onCancelScan}
              onDeletePendingPage={onDeletePendingPage}
              onCreateManualRO={onCreateManualRO}
              scanButtonLabel="Scan RO"
              compact
            />

            <div className="mb-4">
              <input
                type="text"
                placeholder="Search repair orders (RO#, model, VIN)…"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                className="benz-search"
              />
            </div>

            {children}
          </section>
        </div>
      ) : null}
    </div>
  );
}