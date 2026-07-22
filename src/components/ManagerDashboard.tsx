'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  ClipboardList,
  Puzzle,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  UserRound,
  Package,
  Video,
  Wrench,
  Car,
  Phone,
  Briefcase,
  Headset,
  CalendarDays,
  Cpu,
  LayoutDashboard,
} from 'lucide-react';
import Link from 'next/link';
import { DealershipBranding } from '@/components/DealershipBranding';
import { ScanROSection } from '@/components/ScanROSection';
import type { PendingImage } from '@/types';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DashboardSummary, RepairOrder, TechnicianSession } from '@/types';

type ModuleStatusRow = {
  moduleId: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'force_env' | 'dealership' | 'dealer_group' | 'default';
};

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
  onOpenParts?: () => void;
  onOpenSales?: () => void;
  onOpenService?: () => void;
  onOpenMaintenance?: () => void;
  onOpenLoaner?: () => void;
  onOpenVoice?: () => void;
  onOpenHub?: () => void;
  /** Durable Async AI job monitor (SSE + queue). */
  onOpenJobs?: () => void;
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

/** Nav tiles only for modules enabled on this rooftop (or still loading → hide until known). */
function isModuleUiEnabled(
  modules: ModuleStatusRow[] | null,
  moduleId: string
): boolean {
  if (!modules) return false;
  const row = modules.find((m) => m.moduleId === moduleId);
  return Boolean(row?.enabled);
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
  onOpenParts,
  onOpenSales,
  onOpenService,
  onOpenMaintenance,
  onOpenLoaner,
  onOpenVoice,
  onOpenHub,
  onOpenJobs,
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
  const [modules, setModules] = useState<ModuleStatusRow[] | null>(null);
  const [modulesLoading, setModulesLoading] = useState(true);
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [togglingModuleId, setTogglingModuleId] = useState<string | null>(null);

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

  const loadModules = useCallback(async () => {
    setModulesLoading(true);
    setModulesError(null);
    try {
      const data = await api.getModuleStatuses();
      setModules(data.modules);
    } catch (e) {
      setModules(null);
      setModulesError(e instanceof Error ? e.message : 'Failed to load modules');
    } finally {
      setModulesLoading(false);
    }
  }, []);

  const toggleModule = useCallback(
    async (moduleId: string, enabled: boolean) => {
      setTogglingModuleId(moduleId);
      try {
        const data = await api.setModuleEnabled(moduleId, enabled);
        setModules(data.modules);
        if (data.updated.forceEnvActive) {
          toast.message(
            `${moduleId} is forced on via MODULES_FORCE_ENABLE — rooftop row saved but env still wins`
          );
        } else {
          toast.success(
            enabled ? `${data.updated.moduleId} enabled for this rooftop` : `${data.updated.moduleId} disabled`
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to update module');
      } finally {
        setTogglingModuleId(null);
      }
    },
    []
  );

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  const chain = summary?.audit?.chain;
  const isAdmin = session.isAdmin;

  const sourceLabel = (source: ModuleStatusRow['source']) => {
    switch (source) {
      case 'dealership':
        return 'Rooftop';
      case 'dealer_group':
        return 'Group default';
      case 'force_env':
        return 'Forced (env)';
      default:
        return 'Default (off)';
    }
  };

  const moduleDeferredHint = (moduleId: string) => {
    if (moduleId === 'cdk_sync') {
      return 'Live CDK Global API sync is deferred (credentials + legal + connector). Clipboard Copy for CDK still works without this module.';
    }
    return null;
  };

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
        <div className="mt-4 flex justify-center">
          <Link
            href="/manager/center"
            className="primary-btn h-11 px-5 text-xs font-semibold inline-flex items-center gap-2 touch-target-bay"
          >
            <LayoutDashboard size={16} />
            Open Control Center
          </Link>
        </div>
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
                {onOpenParts ? (
                  <button
                    type="button"
                    onClick={onOpenParts}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Package size={14} /> Parts inbox
                  </button>
                ) : null}
                {onOpenSales ? (
                  <button
                    type="button"
                    onClick={onOpenSales}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Briefcase size={14} /> Sales inbox
                  </button>
                ) : null}
                {onOpenService ? (
                  <button
                    type="button"
                    onClick={onOpenService}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Headset size={14} /> Service inbox
                  </button>
                ) : null}
                {onOpenMaintenance ? (
                  <button
                    type="button"
                    onClick={onOpenMaintenance}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Wrench size={14} /> Maintenance
                  </button>
                ) : null}
                {onOpenLoaner ? (
                  <button
                    type="button"
                    onClick={onOpenLoaner}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Car size={14} /> Loaner fleet
                  </button>
                ) : null}
                {onOpenVoice && isModuleUiEnabled(modules, 'voice_agent') ? (
                  <button
                    type="button"
                    onClick={onOpenVoice}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Phone size={14} /> Voice agent
                  </button>
                ) : null}
                {onOpenHub && isModuleUiEnabled(modules, 'calendar_hub') ? (
                  <button
                    type="button"
                    onClick={onOpenHub}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <CalendarDays size={14} /> Calendar hub
                  </button>
                ) : null}
                <Link
                  href="/manager/center"
                  className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                >
                  <LayoutDashboard size={14} /> Control Center
                </Link>
                {onOpenJobs ? (
                  <button
                    type="button"
                    onClick={onOpenJobs}
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Cpu size={14} /> AI Jobs
                  </button>
                ) : (
                  <Link
                    href="/manager/jobs"
                    className="secondary-btn w-full h-11 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Cpu size={14} /> AI Jobs
                  </Link>
                )}
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

            <div className="benz-card p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="benz-avatar text-benz-blue">
                    <Puzzle size={18} />
                  </div>
                  <div>
                    <div className="font-semibold text-sm tracking-tight">Modules</div>
                    <div className="benz-hint mt-0.5">
                      Enable or disable rooftop product modules · core story always on
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="secondary-btn h-9 px-3 text-xs shrink-0"
                  onClick={() => void loadModules()}
                  disabled={modulesLoading || togglingModuleId !== null}
                >
                  Refresh
                </button>
              </div>
              {modulesLoading ? (
                <p className="text-xs text-benz-secondary">Loading module status…</p>
              ) : modulesError ? (
                <p className="text-xs text-benz-amber">{modulesError}</p>
              ) : modules && modules.length > 0 ? (
                <ul className="space-y-2" aria-label="Product module entitlements">
                  {modules.map((mod) => {
                    const deferred = moduleDeferredHint(mod.moduleId);
                    const forced = mod.source === 'force_env';
                    const busy = togglingModuleId === mod.moduleId;
                    return (
                      <li
                        key={mod.moduleId}
                        className="flex items-start justify-between gap-3 rounded-lg border border-benz-border/60 px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold tracking-tight">{mod.name}</div>
                          <div className="text-xs text-benz-secondary mt-0.5 leading-relaxed">
                            {mod.description}
                          </div>
                          <div className="text-[11px] text-benz-secondary/80 mt-1">
                            Source: {sourceLabel(mod.source)}
                            {deferred ? ` · ${deferred}` : ''}
                            {forced ? ' · env override active' : ''}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span
                            className={`status-pill ${
                              mod.enabled ? 'status-pill-valid' : 'status-pill-warn'
                            }`}
                          >
                            {mod.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={mod.enabled}
                            aria-label={`${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`}
                            disabled={busy || forced}
                            title={
                              forced
                                ? 'Controlled by MODULES_FORCE_ENABLE — clear env to manage from UI'
                                : mod.enabled
                                  ? 'Disable for this rooftop'
                                  : 'Enable for this rooftop'
                            }
                            onClick={() => void toggleModule(mod.moduleId, !mod.enabled)}
                            className={`secondary-btn h-9 px-3 text-xs min-w-[5.5rem] disabled:opacity-60 ${
                              mod.enabled ? 'border-benz-green/40' : ''
                            }`}
                          >
                            {busy ? 'Saving…' : mod.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-benz-secondary">No modules configured.</p>
              )}
              <p className="text-[11px] text-benz-secondary mt-3 leading-relaxed">
                Warranty RO story generation stays always available and is not listed as a toggleable
                module. Changes apply only to this rooftop and are audited.
              </p>
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