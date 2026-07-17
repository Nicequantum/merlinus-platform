'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApexDealershipSelector } from '@/components/apex/ApexDealershipSelector';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import {
  formatOwnerActivityAction,
  formatOwnerActivityTime,
} from '@/components/apex/formatOwnerActivity';
import {
  enterOwnerDealership,
  fetchOwnerDealerGroups,
  fetchOwnerDealershipAdvisors,
  fetchOwnerDealerships,
  selectOwnerDealerGroup,
  type OwnerDealerGroupOption,
  type OwnerDealershipAdvisorOption,
  type OwnerViewAsUiRole,
} from '@/lib/apexLoginSession';
import { VIEW_AS_ROLE_OPTIONS } from '@/lib/apex/viewAs';
import type { ApexDealershipOption } from '@/lib/apexDealershipOptions';
import type {
  OwnerNationalSummary,
  OwnerRooftopScorecard,
} from '@/lib/ownerSummaryClient';
import { fetchOwnerNationalSummary } from '@/lib/ownerSummaryClient';
import { formatTrendPct, OwnerSparkline } from '@/components/apex/OwnerSparkline';
import { clientLog } from '@/lib/clientLog';
import type { TechnicianSession } from '@/types';
import { toast } from 'sonner';

type NationalView = 'dashboard' | 'enter-dealership';

interface ApexOwnerNationalShellProps {
  session: TechnicianSession;
  onLogout: () => Promise<void>;
  onSessionRefresh: () => Promise<TechnicianSession | null>;
}

function StatCard({
  label,
  value,
  hint,
  sparkline,
  trendPct,
}: {
  label: string;
  value: string | number;
  hint?: string;
  sparkline?: number[];
  trendPct?: number | null;
}) {
  const trendClass =
    trendPct === null || trendPct === undefined
      ? ''
      : trendPct > 0
        ? 'apex-trend apex-trend--up'
        : trendPct < 0
          ? 'apex-trend apex-trend--down'
          : 'apex-trend';

  return (
    <div className="apex-stat-card">
      <div className="apex-stat-card-top">
        <p className="apex-stat-value">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {sparkline && sparkline.length > 0 ? (
          <OwnerSparkline values={sparkline} label={`${label} trend`} />
        ) : null}
      </div>
      <p className="apex-stat-label">{label}</p>
      {hint || trendPct !== undefined ? (
        <p className="apex-stat-hint">
          {hint}
          {trendPct !== undefined ? (
            <>
              {hint ? ' · ' : null}
              <span className={trendClass}>{formatTrendPct(trendPct)} vs prior 7d</span>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function statusClass(status: OwnerRooftopScorecard['status']): string {
  if (status === 'attention') return 'apex-rooftop-status apex-rooftop-status--attention';
  if (status === 'watch') return 'apex-rooftop-status apex-rooftop-status--watch';
  return 'apex-rooftop-status apex-rooftop-status--healthy';
}

function trendClass(pct: number | null | undefined): string {
  if (pct === null || pct === undefined) return 'apex-trend';
  if (pct > 0) return 'apex-trend apex-trend--up';
  if (pct < 0) return 'apex-trend apex-trend--down';
  return 'apex-trend';
}

function formatGeneratedAt(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function categoryLabel(category?: string): string {
  if (category === 'risk') return 'Risk';
  if (category === 'compliance') return 'Compliance';
  if (category === 'quality') return 'Quality';
  if (category === 'ops') return 'Ops';
  return 'Ops';
}

function RooftopCard({
  rooftop,
  onEnter,
  entering,
}: {
  rooftop: OwnerRooftopScorecard;
  onEnter: (id: string) => void;
  entering: boolean;
}) {
  return (
    <article className="apex-rooftop-card apex-card">
      <div className="apex-rooftop-card-head">
        <div>
          <p className="apex-rooftop-code">{rooftop.dealerCode ?? '—'}</p>
          <h3 className="apex-rooftop-name">{rooftop.name}</h3>
          {rooftop.dealerName ? (
            <p className="apex-hint apex-rooftop-dealer">{rooftop.dealerName}</p>
          ) : null}
        </div>
        <span className={statusClass(rooftop.status)}>{rooftop.status}</span>
      </div>
      {rooftop.roDaily14d?.length ? (
        <div className="apex-rooftop-spark">
          <OwnerSparkline
            values={rooftop.roDaily14d}
            width={160}
            height={32}
            label={`${rooftop.name} RO volume 14 days`}
          />
          <span className={trendClass(rooftop.roVolumeTrendPct)}>
            {formatTrendPct(rooftop.roVolumeTrendPct)}
          </span>
        </div>
      ) : null}
      <dl className="apex-rooftop-metrics">
        <div>
          <dt>RO 7d</dt>
          <dd>{rooftop.roVolume7d}</dd>
        </div>
        <div>
          <dt>RO 30d</dt>
          <dd>{rooftop.roVolume30d}</dd>
        </div>
        <div>
          <dt>Certified 7d</dt>
          <dd>{rooftop.certifiedStories7d}</dd>
        </div>
        <div>
          <dt>Cert rate</dt>
          <dd>
            {rooftop.certificationRatePct === null || rooftop.certificationRatePct === undefined
              ? '—'
              : `${rooftop.certificationRatePct}%`}
          </dd>
        </div>
        <div>
          <dt>Staff depth</dt>
          <dd className="apex-rooftop-depth">
            {rooftop.managers}M · {rooftop.technicians}T · {rooftop.advisors}A
          </dd>
        </div>
        <div>
          <dt>Adoption</dt>
          <dd>{rooftop.adoptionRatePct}%</dd>
        </div>
        <div>
          <dt>AI 7d</dt>
          <dd>{rooftop.aiUsage7d}</dd>
        </div>
        <div>
          <dt>Logins 7d</dt>
          <dd>{rooftop.logins7d}</dd>
        </div>
        <div>
          <dt>Pwd gate</dt>
          <dd>{rooftop.staffMustChangePassword}</dd>
        </div>
      </dl>
      {rooftop.attentionReasons.length > 0 ? (
        <ul className="apex-rooftop-flags">
          {rooftop.attentionReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : (
        <p className="apex-hint apex-rooftop-ok">No attention items</p>
      )}
      <button
        type="button"
        className="apex-btn-secondary apex-rooftop-enter touch-target"
        disabled={entering}
        onClick={() => onEnter(rooftop.dealershipId)}
      >
        Enter rooftop
      </button>
    </article>
  );
}

export function ApexOwnerNationalShell({
  session,
  onLogout,
  onSessionRefresh,
}: ApexOwnerNationalShellProps) {
  const [view, setView] = useState<NationalView>('dashboard');
  const [summary, setSummary] = useState<OwnerNationalSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [dealerships, setDealerships] = useState<ApexDealershipOption[]>([]);
  const [loadingDealerships, setLoadingDealerships] = useState(false);
  const [dealerGroups, setDealerGroups] = useState<OwnerDealerGroupOption[]>([]);
  const [switchingGroup, setSwitchingGroup] = useState(false);
  const [viewAsRole, setViewAsRole] = useState<OwnerViewAsUiRole>('manager');
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>('');
  const [advisors, setAdvisors] = useState<OwnerDealershipAdvisorOption[]>([]);
  const [loadingAdvisors, setLoadingAdvisors] = useState(false);
  const [advisorRooftopId, setAdvisorRooftopId] = useState<string | null>(null);

  const isGroupHome = session.scopeMode === 'group';
  const homeTitle = isGroupHome
    ? session.dealerGroupName || 'Group operations'
    : 'National Operations';
  const scopeBadge = isGroupHome ? 'Group' : 'National';
  const showGroupSwitcher = dealerGroups.length > 1;
  const needsAdvisorPick = viewAsRole === 'service_advisor';

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await fetchOwnerNationalSummary();
      setSummary(data);
    } catch (error: unknown) {
      clientLog.error('owner.summary_load_failed', error);
      setSummaryError(error instanceof Error ? error.message : 'Could not load dashboard');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // Phase 7.3 — multi-group switcher options
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { groups } = await fetchOwnerDealerGroups();
        if (!cancelled) setDealerGroups(groups);
      } catch (error) {
        clientLog.error('owner.dealer_groups_load_failed', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSwitchGroup = useCallback(
    async (dealerGroupId: string) => {
      if (switchingGroup) return;
      if (dealerGroupId === (session.activeDealerGroupId || '')) return;
      setSwitchingGroup(true);
      try {
        await selectOwnerDealerGroup(dealerGroupId);
        toast.success('Switched dealer group portfolio');
        await onSessionRefresh();
        await loadSummary();
      } catch (error: unknown) {
        clientLog.error('owner.select_group_failed', error);
        toast.error(error instanceof Error ? error.message : 'Could not switch group');
      } finally {
        setSwitchingGroup(false);
      }
    },
    [switchingGroup, session.activeDealerGroupId, onSessionRefresh, loadSummary]
  );

  const openEnterDealership = useCallback(async () => {
    setView('enter-dealership');
    setLoadingDealerships(true);
    setAdvisors([]);
    setSelectedAdvisorId('');
    setAdvisorRooftopId(null);
    try {
      const list = await fetchOwnerDealerships();
      setDealerships(list);
    } catch (error: unknown) {
      clientLog.error('owner.dealerships_load_failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not load dealerships');
      setView('dashboard');
    } finally {
      setLoadingDealerships(false);
    }
  }, []);

  const handleEnterDealership = async (dealershipId: string) => {
    setActionLoading(true);
    try {
      let advisorId: string | null = null;
      if (viewAsRole === 'service_advisor') {
        let list = advisors;
        if (advisorRooftopId !== dealershipId || list.length === 0) {
          setLoadingAdvisors(true);
          setAdvisorRooftopId(dealershipId);
          try {
            list = await fetchOwnerDealershipAdvisors(dealershipId);
            setAdvisors(list);
            const pick =
              selectedAdvisorId && list.some((a) => a.id === selectedAdvisorId)
                ? selectedAdvisorId
                : list[0]?.id ?? '';
            setSelectedAdvisorId(pick);
            advisorId = pick || null;
          } finally {
            setLoadingAdvisors(false);
          }
        } else {
          advisorId =
            (selectedAdvisorId && list.some((a) => a.id === selectedAdvisorId)
              ? selectedAdvisorId
              : list[0]?.id) || null;
        }
        // Server auto-binds first advisor when id omitted; prefer explicit when available.
      }

      const roleLabel =
        VIEW_AS_ROLE_OPTIONS.find((o) => o.value === viewAsRole)?.label ?? viewAsRole;

      await enterOwnerDealership(dealershipId, {
        viewAsRole,
        viewAsServiceAdvisorId: viewAsRole === 'service_advisor' ? advisorId : null,
      });
      const latest = await onSessionRefresh();
      if (!latest || latest.scopeMode !== 'dealership') {
        throw new Error('Dealership entered but session did not update');
      }
      toast.success(`Viewing ${latest.dealershipName} as ${roleLabel}`);
    } catch (error: unknown) {
      clientLog.error('owner.dealership_enter_failed', error);
      toast.error(error instanceof Error ? error.message : 'Could not enter dealership');
    } finally {
      setActionLoading(false);
    }
  };

  const viewAsControls = (
    <div className="apex-view-as-controls">
      <label className="apex-view-as-field">
        <span className="apex-hint">View as</span>
        <select
          className="apex-view-as-select touch-target"
          value={viewAsRole}
          disabled={actionLoading}
          aria-label="View as staff role"
          onChange={(e) => {
            const next = e.target.value as OwnerViewAsUiRole;
            setViewAsRole(next);
            if (next !== 'service_advisor') {
              setSelectedAdvisorId('');
            }
          }}
        >
          {VIEW_AS_ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {needsAdvisorPick && advisorRooftopId ? (
        <label className="apex-view-as-field">
          <span className="apex-hint">Advisor</span>
          <select
            className="apex-view-as-select touch-target"
            value={selectedAdvisorId}
            disabled={actionLoading || loadingAdvisors || advisors.length === 0}
            aria-label="Service advisor to view as"
            onChange={(e) => setSelectedAdvisorId(e.target.value)}
          >
            {advisors.length === 0 ? (
              <option value="">
                {loadingAdvisors ? 'Loading…' : 'No active advisors'}
              </option>
            ) : (
              advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName}
                  {a.advisorCode ? ` (${a.advisorCode})` : ''}
                </option>
              ))
            )}
          </select>
        </label>
      ) : null}
    </div>
  );

  return (
    <div className="apex-app-root apex-national-dashboard" data-platform="apex">
      <div className="apex-ambient apex-ambient--dashboard" aria-hidden="true">
        <div className="apex-ambient-grid" />
        <div className="apex-ambient-logo-wash" />
        <div className="apex-ambient-circuit" />
      </div>

      <header className="apex-national-header">
        <div className="apex-national-header-inner">
          <div className="apex-national-header-brand">
            <ApexLogoMark size="sm" title="Apex National Platform" />
            <div>
              <p className="apex-national-header-title">{homeTitle}</p>
              <p className="apex-national-header-user">{session.name}</p>
            </div>
          </div>
          <div className="apex-national-header-actions">
            {showGroupSwitcher ? (
              <label className="apex-group-switcher">
                <span className="apex-hint">Portfolio</span>
                <select
                  className="apex-group-switcher-select touch-target"
                  disabled={switchingGroup || actionLoading}
                  value={session.activeDealerGroupId || ''}
                  aria-label="Switch dealer group portfolio"
                  onChange={(e) => void onSwitchGroup(e.target.value)}
                >
                  {dealerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.isPrimary ? ' (primary)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {view === 'dashboard' ? viewAsControls : null}
            <div className="apex-scope-badge" aria-label="Current scope">
              <span aria-hidden="true">◆</span>
              {scopeBadge}
            </div>
            <button
              type="button"
              className="apex-btn-secondary apex-national-signout touch-target"
              onClick={() => void onLogout()}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="apex-national-main">
        {view === 'enter-dealership' ? (
          <section className="apex-national-panel apex-card apex-card-accent apex-national-panel--wide">
            <div className="apex-national-panel-head">
              <div>
                <h2 className="apex-national-panel-title">View as · enter rooftop</h2>
                <p className="apex-hint">
                  {isGroupHome
                    ? 'Pick a staff lens and a rooftop in your group. Identity stays National Owner; this is audited.'
                    : 'Pick a staff lens and a rooftop. Identity stays National Owner; this is audited.'}
                </p>
              </div>
              <button
                type="button"
                className="apex-btn-secondary touch-target"
                disabled={actionLoading}
                onClick={() => setView('dashboard')}
              >
                Back
              </button>
            </div>
            <div className="apex-view-as-enter-panel">
              {viewAsControls}
              <p className="apex-hint apex-view-as-role-desc">
                {VIEW_AS_ROLE_OPTIONS.find((o) => o.value === viewAsRole)?.description}
              </p>
            </div>
            {loadingDealerships ? (
              <p className="apex-hint apex-enter-loading">Loading rooftops…</p>
            ) : (
              <ApexDealershipSelector
                dealerships={dealerships}
                loading={actionLoading}
                showRememberDefault={false}
                title="Choose rooftop"
                subtitle={
                  isGroupHome
                    ? 'Group scope has no PII until you enter a dealership in your portfolio.'
                    : 'National scope has no PII access until you enter a dealership.'
                }
                onSelect={(dealershipId) => void handleEnterDealership(dealershipId)}
              />
            )}
          </section>
        ) : (
          <>
            <section className="apex-national-hero apex-card apex-card-accent">
              <div className="apex-national-hero-copy">
                <p className="apex-login-kicker">
                  {isGroupHome ? 'Group command center' : 'Command center'}
                </p>
                <h1 className="apex-national-hero-title">
                  {isGroupHome
                    ? `${session.dealerGroupName || 'Group'} overview`
                    : 'National operations overview'}
                </h1>
                <p className="apex-national-hero-subtitle">
                  {isGroupHome
                    ? 'Complete portfolio command center — Tier 1 health, Tier 2 trends, and Tier 3 risk flags. No customer PII until you enter a rooftop.'
                    : 'Aggregate visibility across dealers and rooftops — trends, attention flags, and operating health without customer PII.'}
                </p>
              </div>
              <div className="apex-national-hero-actions">
                <button
                  type="button"
                  className="apex-btn-primary apex-national-enter-btn touch-target"
                  // Phase 5.8/5.9 gate: "Enter dealership" + View As dual selector CTA
                  aria-label="Enter dealership — View as / enter rooftop"
                  onClick={() => void openEnterDealership()}
                >
                  View as / enter rooftop
                </button>
                <p className="apex-hint" style={{ marginTop: '0.5rem', maxWidth: '16rem' }}>
                  Video Inspection: enter a rooftop to record bay videos and send customer
                  reports.
                </p>
                <button
                  type="button"
                  className="apex-btn-secondary touch-target"
                  disabled={summaryLoading}
                  onClick={() => void loadSummary()}
                >
                  Refresh metrics
                </button>
              </div>
            </section>

            {summaryLoading ? (
              <div className="apex-national-panel apex-card apex-national-loading-card" role="status">
                <p className="apex-hint apex-national-loading">
                  {isGroupHome ? 'Loading group metrics…' : 'Loading national metrics…'}
                </p>
                <p className="apex-hint">Computing portfolio trends and attention flags.</p>
              </div>
            ) : summaryError ? (
              <div className="apex-national-panel apex-card apex-error-panel" role="alert">
                <h2 className="apex-national-panel-title">Could not load dashboard</h2>
                <p className="apex-hint">{summaryError}</p>
                <p className="apex-hint">
                  Check your network connection and try again. If this persists, contact platform
                  support — audit-gated metrics fail closed for compliance.
                </p>
                <button
                  type="button"
                  className="apex-btn-primary touch-target"
                  onClick={() => void loadSummary()}
                >
                  Retry
                </button>
              </div>
            ) : summary ? (
              <>
                {summary.generatedAt ? (
                  <p className="apex-dashboard-meta">
                    Updated {formatGeneratedAt(summary.generatedAt)}
                    {summary.scopeMode === 'group' && summary.dealerGroupName
                      ? ` · ${summary.dealerGroupName}`
                      : summary.scopeMode === 'national'
                        ? ' · Platform national'
                        : ''}
                  </p>
                ) : null}

                <p className="apex-section-label">Tier 1 — Portfolio health</p>
                <section
                  className="apex-stat-grid apex-stat-grid--tier1"
                  aria-label={isGroupHome ? 'Group Tier 1 metrics' : 'National Tier 1 metrics'}
                >
                  <StatCard label="Rooftops active" value={summary.dealershipCount} />
                  <StatCard label="Brands / dealers" value={summary.dealerCount} />
                  <StatCard label="Active staff" value={summary.activeUsers} />
                  <StatCard
                    label="RO volume"
                    value={summary.repairOrders7d}
                    hint={`${summary.repairOrders30d.toLocaleString()} in 30d`}
                    sparkline={summary.volumeTrend?.values}
                    trendPct={summary.volumeTrend?.changePct}
                  />
                  <StatCard
                    label="Stories certified"
                    value={summary.certifiedStories7d}
                    hint={`${summary.certifiedStories30d.toLocaleString()} in 30d`}
                    sparkline={summary.certificationTrend?.values}
                    trendPct={summary.certificationTrend?.changePct}
                  />
                  <StatCard
                    label="Adoption rate"
                    value={`${summary.adoptionRatePct}%`}
                    hint="Active staff with activity (7d)"
                  />
                  <StatCard
                    label="Attention flags"
                    value={summary.attentionFlagCount}
                    hint={
                      summary.attentionFlagCount === 0
                        ? 'All clear'
                        : 'Review flags below'
                    }
                  />
                </section>

                <p className="apex-section-label">Tier 2 — Trends & operating performance</p>
                <section
                  className="apex-stat-grid apex-stat-grid--tier2"
                  aria-label={isGroupHome ? 'Group Tier 2 metrics' : 'National Tier 2 metrics'}
                >
                  <StatCard
                    label="Volume trend"
                    value={formatTrendPct(summary.volumeTrend?.changePct)}
                    hint={`7d ${summary.volumeTrend?.current7d ?? summary.repairOrders7d} vs prior ${summary.volumeTrend?.prior7d ?? '—'}`}
                    sparkline={summary.volumeTrend?.values}
                    trendPct={summary.volumeTrend?.changePct}
                  />
                  <StatCard
                    label="Certification rate"
                    value={
                      summary.certificationRatePct === null ||
                      summary.certificationRatePct === undefined
                        ? '—'
                        : `${summary.certificationRatePct}%`
                    }
                    hint="Certified stories ÷ RO volume (7d)"
                    sparkline={summary.certificationTrend?.values}
                  />
                  <StatCard
                    label="Time-to-certify"
                    value={
                      summary.medianTimeToCertifyHours === null ||
                      summary.medianTimeToCertifyHours === undefined
                        ? '—'
                        : `${summary.medianTimeToCertifyHours}h`
                    }
                    hint="Median hours RO create → certify (30d)"
                  />
                  <StatCard
                    label="AI usage (7d)"
                    value={summary.aiUsage7d ?? 0}
                    hint="Usage log hits across portfolio"
                  />
                  <StatCard
                    label="Login health"
                    value={summary.logins7d ?? 0}
                    hint={
                      (summary.staffMustChangePassword ?? 0) > 0
                        ? `${summary.staffMustChangePassword} password changes pending`
                        : 'Logins in last 7 days'
                    }
                  />
                  <StatCard
                    label="Staff depth"
                    value={summary.activeUsers}
                    hint="See managers / techs / advisors per rooftop"
                  />
                </section>

                <p className="apex-section-label">Tier 3 — Risk, compliance & exceptions</p>
                <section className="apex-national-panel apex-card apex-attention-panel">
                  <div className="apex-national-panel-head">
                    <div>
                      <h2 className="apex-national-panel-title">Attention & exceptions</h2>
                      <p className="apex-hint">
                        Ops, risk, compliance, and quality flags — sorted by severity. Still
                        PII-free.
                      </p>
                    </div>
                    <span className="apex-attention-count">
                      {summary.attentionFlagCount} flag
                      {summary.attentionFlagCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {summary.attentionFlags.length === 0 ? (
                    <div className="apex-empty-state">
                      <p className="apex-empty-title">All clear</p>
                      <p className="apex-hint">
                        No attention flags in this portfolio right now. Keep monitoring volume and
                        certification trends above.
                      </p>
                    </div>
                  ) : (
                    <ul className="apex-attention-list">
                      {summary.attentionFlags.map((flag, i) => (
                        <li
                          key={`${flag.code}-${flag.dealershipId ?? 'g'}-${i}`}
                          className={
                            flag.severity === 'attention'
                              ? 'apex-attention-item apex-attention-item--attention'
                              : 'apex-attention-item apex-attention-item--watch'
                          }
                        >
                          <span className="apex-attention-severity">{flag.severity}</span>
                          <span className="apex-attention-category">
                            {categoryLabel(flag.category)}
                          </span>
                          <span>
                            {flag.label}
                            {flag.dealershipName ? ` · ${flag.dealershipName}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <p className="apex-section-label">Rooftop comparison</p>
                <section className="apex-national-panel apex-card">
                  <div className="apex-national-panel-head">
                    <div>
                      <h2 className="apex-national-panel-title">Scoreboard</h2>
                      <p className="apex-hint">
                        Attention rooftops first — volume sparks, staff depth, cert rate, login
                        health. Enter for PII access.
                      </p>
                    </div>
                  </div>
                  {summary.rooftops.length === 0 ? (
                    <div className="apex-empty-state">
                      <p className="apex-empty-title">No rooftops yet</p>
                      <p className="apex-hint">
                        {isGroupHome
                          ? 'Link dealers to this DealerGroup or provision rooftops, then refresh.'
                          : 'No dealerships found on the platform.'}
                      </p>
                    </div>
                  ) : (
                    <div className="apex-rooftop-grid">
                      {summary.rooftops.map((rooftop) => (
                        <RooftopCard
                          key={rooftop.dealershipId}
                          rooftop={rooftop}
                          entering={actionLoading}
                          onEnter={(id) => void handleEnterDealership(id)}
                        />
                      ))}
                    </div>
                  )}
                </section>

                <p className="apex-section-label">Activity</p>
                <section className="apex-national-panel apex-card">
                  <div className="apex-national-panel-head">
                    <h2 className="apex-national-panel-title">
                      {isGroupHome ? 'Recent group activity' : 'Recent platform activity'}
                    </h2>
                  </div>
                  {summary.recentActivity.length === 0 ? (
                    <p className="apex-hint">No recent activity recorded.</p>
                  ) : (
                    <ul className="apex-activity-feed">
                      {summary.recentActivity.map((item) => (
                        <li key={item.id} className="apex-activity-item">
                          <div className="apex-activity-top">
                            <span className="apex-activity-action">
                              {formatOwnerActivityAction(item.action)}
                            </span>
                            <time className="apex-activity-time" dateTime={item.createdAt}>
                              {formatOwnerActivityTime(item.createdAt)}
                            </time>
                          </div>
                          <p className="apex-activity-meta">
                            {item.dealershipName ?? 'Platform'}
                            {item.dealerCode ? ` · ${item.dealerCode}` : ''}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
