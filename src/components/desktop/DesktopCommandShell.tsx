'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Calendar,
  Car,
  ClipboardList,
  Cpu,
  Home,
  LayoutDashboard,
  LayoutList,
  MonitorSmartphone,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  Video,
  Wrench,
} from 'lucide-react';
import { CompanionActivitySidebar } from '@/components/desktop/CompanionActivitySidebar';
import { CompanionConnectionBadge } from '@/components/desktop/CompanionConnectionBadge';
import { CompanionStatusBar } from '@/components/desktop/CompanionStatusBar';
import { LiveTechnicianSessionBadge } from '@/components/desktop/LiveTechnicianSessionBadge';
import { useDesktopKeyboardShortcuts } from '@/hooks/useDesktopKeyboardShortcuts';
import {
  loadDesktopLayoutPrefs,
  saveDesktopLayoutPrefs,
  type DesktopLayoutPrefs,
} from '@/lib/desktopLayoutPrefs';
import type {
  CompanionActivityEntry,
  CompanionConnectionState,
  CompanionWorkflowStatus,
} from '@/lib/companionSyncTypes';
import type { AppView, RepairOrderSummary } from '@/types';

export type DesktopNavId =
  | 'home'
  | 'settings'
  | 'videoInspection'
  | 'parts'
  | 'service'
  | 'sales'
  | 'loaner'
  | 'maintenance'
  | 'voice'
  | 'hub'
  | 'jobs'
  | 'center';

interface DesktopCommandShellProps {
  view: AppView;
  technicianName?: string | null;
  dealershipName?: string | null;
  currentRoNumber?: string | null;
  currentLineLabel?: string | null;
  connectionState: CompanionConnectionState;
  workflowStatus: CompanionWorkflowStatus;
  statusMessage?: string | null;
  statusProgress?: number | null;
  activities: CompanionActivityEntry[];
  liveTechnicianSession: boolean;
  liveWorkflowStatus?: CompanionWorkflowStatus;
  liveLastSeenAt?: string | null;
  roSummaries?: RepairOrderSummary[];
  onOpenRo?: (id: string) => void;
  onNavigate: (dest: DesktopNavId | 'home') => void;
  onGenerateStory?: () => void;
  onCopyStory?: () => void;
  /** Global search bound to home RO search when on home */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  children: React.ReactNode;
  topSlot?: React.ReactNode;
}

const NAV: Array<{ id: DesktopNavId; label: string; icon: React.ReactNode; group?: string }> = [
  { id: 'home', label: 'RO list', icon: <Home size={16} />, group: 'Bay' },
  { id: 'videoInspection', label: 'Video MPI', icon: <Video size={16} />, group: 'Bay' },
  { id: 'service', label: 'Service', icon: <Wrench size={16} />, group: 'Inbox' },
  { id: 'parts', label: 'Parts', icon: <ClipboardList size={16} />, group: 'Inbox' },
  { id: 'sales', label: 'Sales', icon: <Car size={16} />, group: 'Inbox' },
  { id: 'loaner', label: 'Loaner', icon: <Car size={16} />, group: 'Fleet' },
  { id: 'maintenance', label: 'Maintenance', icon: <Wrench size={16} />, group: 'Fleet' },
  { id: 'hub', label: 'Calendar Hub', icon: <Calendar size={16} />, group: 'Ops' },
  { id: 'voice', label: 'Voice ops', icon: <Activity size={16} />, group: 'Ops' },
  { id: 'center', label: 'Control Center', icon: <LayoutDashboard size={16} />, group: 'Manager' },
  { id: 'jobs', label: 'AI Jobs', icon: <Cpu size={16} />, group: 'Manager' },
  { id: 'settings', label: 'Settings', icon: <Settings size={16} />, group: 'Account' },
];

const VIEW_TITLES: Partial<Record<AppView, string>> = {
  home: 'Repair orders',
  ro: 'Repair order',
  line: 'Repair line',
  settings: 'Settings',
  audit: 'Audit log',
  advisors: 'Service advisors',
  technicians: 'Technicians',
  videoInspection: 'Video MPI',
  parts: 'Parts inbox',
  sales: 'Sales inbox',
  service: 'Service inbox',
  maintenance: 'Maintenance',
  loaner: 'Loaner fleet',
  voice: 'Voice operations',
  hub: 'Calendar Hub',
  jobs: 'AI Jobs',
};

/**
 * Desktop command center: nav rail, top search bar, optional RO split + activity dock.
 * Children = full module pages (mobile components with desktop CSS density).
 */
export function DesktopCommandShell({
  view,
  technicianName,
  dealershipName,
  currentRoNumber,
  currentLineLabel,
  connectionState,
  workflowStatus,
  statusMessage,
  statusProgress,
  activities,
  liveTechnicianSession,
  liveWorkflowStatus,
  liveLastSeenAt,
  roSummaries = [],
  onOpenRo,
  onNavigate,
  onGenerateStory,
  onCopyStory,
  searchValue,
  onSearchChange,
  children,
  topSlot,
}: DesktopCommandShellProps) {
  const [prefs, setPrefs] = useState<DesktopLayoutPrefs>(() => loadDesktopLayoutPrefs());
  const searchRef = useRef<HTMLInputElement>(null);

  const updatePrefs = useCallback((patch: Partial<DesktopLayoutPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveDesktopLayoutPrefs(next);
      return next;
    });
  }, []);

  useDesktopKeyboardShortcuts({
    enabled: true,
    onSearchFocus: () => {
      searchRef.current?.focus();
      onSearchChange?.(searchValue ?? '');
    },
    onGenerateStory,
    onGoHome: () => onNavigate('home'),
    onCopyStory,
    onToggleActivity: () => updatePrefs({ showActivity: !prefs.showActivity }),
  });

  const showSplit =
    prefs.splitRoList &&
    (view === 'ro' || view === 'line' || view === 'home') &&
    roSummaries.length > 0 &&
    onOpenRo;

  const showActivityDock =
    prefs.showActivity && (view === 'ro' || view === 'line' || liveTechnicianSession);

  const title = useMemo(() => {
    if (currentRoNumber) {
      return currentLineLabel
        ? `${currentRoNumber} · ${currentLineLabel}`
        : currentRoNumber;
    }
    return VIEW_TITLES[view] || 'Dealership command center';
  }, [currentLineLabel, currentRoNumber, view]);

  const isNavActive = (id: DesktopNavId) => {
    if (id === 'home') return view === 'home' || view === 'ro' || view === 'line';
    return view === id;
  };

  return (
    <div className="benz-command-shell">
      <aside
        className={`benz-command-nav ${prefs.collapsedNav ? 'benz-command-nav-collapsed' : ''}`}
        aria-label="Desktop navigation"
      >
        <div className="benz-command-nav-brand">
          <MonitorSmartphone size={18} className="text-benz-blue shrink-0" />
          {!prefs.collapsedNav ? (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-benz-secondary">
              Merlinus
            </span>
          ) : null}
        </div>
        <nav className="benz-command-nav-list">
          {NAV.map((item, i) => {
            const prevGroup = i > 0 ? NAV[i - 1]?.group : null;
            const showGroup = !prefs.collapsedNav && item.group && item.group !== prevGroup;
            return (
              <div key={item.id}>
                {showGroup ? (
                  <div className="benz-command-nav-group">{item.group}</div>
                ) : null}
                <button
                  type="button"
                  className={`benz-command-nav-item ${isNavActive(item.id) ? 'active' : ''}`}
                  onClick={() => onNavigate(item.id)}
                  title={item.label}
                >
                  {item.icon}
                  {!prefs.collapsedNav ? <span>{item.label}</span> : null}
                </button>
              </div>
            );
          })}
        </nav>
        <button
          type="button"
          className="benz-command-nav-item mt-auto"
          onClick={() => updatePrefs({ collapsedNav: !prefs.collapsedNav })}
          title={prefs.collapsedNav ? 'Expand nav' : 'Collapse nav'}
        >
          <LayoutList size={16} />
          {!prefs.collapsedNav ? <span>Collapse</span> : null}
        </button>
      </aside>

      <div className="benz-command-main-col">
        <header className="benz-command-header">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-benz-primary truncate">{title}</h1>
              <CompanionConnectionBadge state={connectionState} />
              <LiveTechnicianSessionBadge
                active={liveTechnicianSession}
                workflowStatus={liveWorkflowStatus || workflowStatus}
                lastSeenAt={liveLastSeenAt}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="benz-command-search relative flex-1 min-w-[12rem] max-w-md">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-benz-muted pointer-events-none"
                />
                <input
                  ref={searchRef}
                  type="search"
                  className="benz-input h-9 pl-8 text-sm w-full"
                  placeholder="Search ROs, customers, VINs… (Ctrl+K)"
                  value={searchValue ?? ''}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  onFocus={() => {
                    if (view !== 'home' && view !== 'ro' && view !== 'line') {
                      onNavigate('home');
                    }
                  }}
                />
              </label>
              <div className="text-[11px] text-benz-muted hidden xl:block">
                {technicianName || 'User'}
                {dealershipName ? ` · ${dealershipName}` : ''}
              </div>
            </div>
            <p className="text-[10px] text-benz-muted hidden sm:block">
              Ctrl+K search · Ctrl+Enter generate · Ctrl+H home · Ctrl+Shift+B activity · Ctrl+Shift+C
              copy story
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="secondary-btn h-9 px-2.5 text-xs"
              onClick={() => updatePrefs({ splitRoList: !prefs.splitRoList })}
              title="Toggle RO list rail"
            >
              Split {prefs.splitRoList ? 'on' : 'off'}
            </button>
            <button
              type="button"
              className="secondary-btn h-9 px-2.5 text-xs inline-flex items-center gap-1"
              onClick={() => updatePrefs({ showActivity: !prefs.showActivity })}
              title="Toggle activity dock"
            >
              {prefs.showActivity ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
              Activity
            </button>
          </div>
        </header>

        {(workflowStatus !== 'idle' || statusMessage) && (view === 'ro' || view === 'line') ? (
          <CompanionStatusBar
            status={workflowStatus}
            message={statusMessage}
            progress={statusProgress}
          />
        ) : null}

        {topSlot}

        <div
          className="benz-command-workspace"
          style={
            showActivityDock
              ? ({ ['--activity-w' as string]: `${prefs.activityWidthPx}px` } as React.CSSProperties)
              : undefined
          }
        >
          {showSplit ? (
            <aside className="benz-command-ro-rail" aria-label="Repair orders">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-benz-secondary px-2 py-2">
                ROs
              </div>
              <ul className="benz-command-ro-list">
                {roSummaries.slice(0, 50).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="benz-command-ro-item"
                      onClick={() => onOpenRo?.(item.id)}
                    >
                      <span className="font-semibold">{item.roNumber}</span>
                      <span className="text-benz-secondary text-[11px] truncate block">
                        {[item.vehicle?.year, item.vehicle?.make, item.vehicle?.model]
                          .filter(Boolean)
                          .join(' ') || 'Vehicle'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}

          <main className="benz-command-content">{children}</main>

          {showActivityDock ? (
            <aside className="benz-command-activity" aria-label="Live activity">
              <CompanionActivitySidebar activities={activities} />
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
