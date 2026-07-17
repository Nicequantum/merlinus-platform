'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  ClipboardList,
  Sparkles,
  Type,
  UserPlus,
  UserRound,
  UserX,
} from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  formatMetricCurrency,
  formatMetricNumber,
  formatMetricPercent,
} from '@/lib/advisorMetricsFormat';
import type { AdvisorDetail, AdvisorListItem, AdvisorPerformanceMetrics } from '@/types';

interface ServiceAdvisorsViewProps {
  onBack: () => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="benz-list-row p-3">
      <div className="text-xs text-benz-secondary">{label}</div>
      <div className="font-semibold text-base mt-1 tracking-tight">{value}</div>
      {hint ? <div className="text-[11px] text-benz-muted mt-1 leading-snug">{hint}</div> : null}
    </div>
  );
}

function AdvisorMetricsPanel({ metrics }: { metrics: AdvisorPerformanceMetrics }) {
  return (
    <div className="benz-card p-4">
      <div className="flex items-center gap-2 benz-section-title mb-3">
        <BarChart3 size={14} />
        Performance Metrics
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <MetricTile
          label="Approval rate"
          value={formatMetricPercent(metrics.approvalRate)}
          hint="Warranty stories scoring ≥ 75 on MI audit"
        />
        <MetricTile
          label="Closing ratio"
          value={formatMetricPercent(metrics.closingRatio)}
          hint="Certified stories vs warranty lines with stories"
        />
        <MetricTile
          label="Avg RO value"
          value={formatMetricCurrency(metrics.avgRepairOrderValue)}
          hint="Requires DMS financial feed"
        />
        <MetricTile
          label="Total revenue"
          value={formatMetricCurrency(metrics.totalRevenue)}
          hint="Requires DMS financial feed"
        />
        <MetricTile
          label="ROs written"
          value={formatMetricNumber(metrics.rosWritten)}
        />
        <MetricTile
          label="Upsell / add-on rate"
          value={formatMetricPercent(metrics.upsellRate)}
          hint="Customer-pay lines on advisor ROs"
        />
        <MetricTile
          label="CSI score"
          value={metrics.csiScore == null ? '—' : `${metrics.csiScore}`}
          hint={metrics.csiScore == null ? 'Not recorded for this advisor' : 'Dealership CSI'}
        />
      </div>
    </div>
  );
}

function AdvisorDetailPanel({
  advisor,
  actionLoading,
  onDeactivate,
  onReactivate,
  onRemove,
}: {
  advisor: AdvisorDetail;
  actionLoading: boolean;
  onDeactivate: () => void;
  onReactivate: () => void;
  onRemove: () => void;
}) {
  const profile = advisor.profile?.profileData;
  const formatting = profile?.formatting;
  const affinities = profile
    ? Object.entries(profile.vehicleAffinities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-4">
      <div className="benz-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold tracking-tight">{advisor.displayName}</div>
            <div className="text-xs text-benz-secondary mt-1">
              {advisor.advisorCode ? `${advisor.advisorCode} · ` : ''}
              {advisor.roCount} linked RO{advisor.roCount === 1 ? '' : 's'} · First seen{' '}
              {formatDate(advisor.firstSeenAt)}
            </div>
            {advisor.status === 'inactive' ? (
              <span className="status-pill status-pill-warn mt-2 inline-flex">Inactive</span>
            ) : null}
          </div>
          <span className="status-pill bg-benz-accent/15 text-benz-blue border border-benz-accent/30">
            {advisor.profile?.observationCount ?? 0} obs
          </span>
        </div>
      </div>

      <AdvisorMetricsPanel metrics={advisor.metrics} />

      <div className="benz-card p-4">
        <div className="benz-section-title mb-3">Management</div>
        <div className="flex flex-wrap gap-2">
          {advisor.status === 'active' ? (
            <button
              type="button"
              onClick={onDeactivate}
              disabled={actionLoading}
              className="secondary-btn text-xs h-9 px-3 disabled:opacity-50"
            >
              {actionLoading ? 'Updating…' : 'Deactivate'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onReactivate}
              disabled={actionLoading}
              className="secondary-btn text-xs h-9 px-3 disabled:opacity-50"
            >
              {actionLoading ? 'Updating…' : 'Reactivate'}
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            disabled={actionLoading}
            className="secondary-btn text-xs h-9 px-3 text-benz-warn border-benz-warn/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            <UserX size={14} />
            {actionLoading ? 'Removing…' : 'Remove advisor'}
          </button>
        </div>
        <p className="text-xs text-benz-secondary leading-relaxed mt-3">
          Removing an advisor hides them from active lists. Their repair orders, complaint
          observations, and audit history remain in the database.
        </p>
      </div>

      {formatting && (
        <div className="benz-card p-4">
          <div className="benz-section-title mb-3">Writing Style</div>
          <div className="grid grid-cols-2 gap-2.5 text-sm">
            <div className="benz-list-row p-3">
              <div className="text-xs text-benz-secondary">Avg length</div>
              <div className="font-medium mt-1">{formatting.avgComplaintLength || '—'} chars</div>
            </div>
            <div className="benz-list-row p-3">
              <div className="text-xs text-benz-secondary">Complaints / RO</div>
              <div className="font-medium mt-1">{formatting.avgComplaintsPerRo || '—'}</div>
            </div>
            <div className="benz-list-row p-3">
              <div className="text-xs text-benz-secondary">Letter labels</div>
              <div className="font-medium mt-1">{formatting.usesLetterLabels ? 'Yes' : 'No'}</div>
            </div>
            <div className="benz-list-row p-3">
              <div className="text-xs text-benz-secondary">All caps</div>
              <div className="font-medium mt-1">{formatting.typicallyAllCaps ? 'Usually' : 'Mixed'}</div>
            </div>
          </div>
        </div>
      )}

      {profile && profile.commonPhrases.length > 0 && (
        <div className="benz-card p-4">
          <div className="flex items-center gap-2 benz-section-title mb-3">
            <Type size={14} />
            Common Phrases
          </div>
          <div className="space-y-2">
            {profile.commonPhrases.slice(0, 8).map((phrase) => (
              <div key={phrase.text} className="benz-list-row flex justify-between gap-3 px-3 py-2.5">
                <span className="text-sm">{phrase.text}</span>
                <span className="text-xs text-benz-secondary shrink-0">{phrase.count}x</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {affinities.length > 0 && (
        <div className="benz-card p-4">
          <div className="benz-section-title mb-3">Vehicle Families</div>
          <div className="flex flex-wrap gap-2">
            {affinities.map(([family, weight]) => (
              <span key={family} className="status-pill status-pill-valid">
                {family} {Math.round(weight * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      {advisor.recentObservations.length > 0 && (
        <div className="benz-card p-4">
          <div className="flex items-center gap-2 benz-section-title mb-3">
            <ClipboardList size={14} />
            Recent Complaints
          </div>
          <div className="space-y-2">
            {advisor.recentObservations.map((obs) => (
              <div key={obs.id} className="benz-list-row px-3 py-2.5">
                <div className="flex justify-between items-center gap-2 mb-1">
                  <span className="text-xs text-benz-blue font-semibold">
                    RO {obs.roNumber}
                    {obs.lineLabel ? ` · Line ${obs.lineLabel}` : ''}
                  </span>
                  <span className="text-xs text-benz-secondary">{formatDate(obs.observedAt)}</span>
                </div>
                <div className="text-sm leading-snug">{obs.complaint}</div>
                {obs.vehicle ? <div className="text-xs text-benz-secondary mt-1">{obs.vehicle}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="benz-card p-4 benz-alert-info border">
        <div className="flex items-center gap-2 text-benz-blue text-sm font-medium mb-2">
          <Sparkles size={16} />
          Advisor intelligence
        </div>
        <p className="text-xs text-benz-secondary leading-relaxed">
          Profiles build automatically from scanned repair orders. Managers can also add advisors
          manually before their first RO appears in Merlin.
        </p>
      </div>
    </div>
  );
}

export function ServiceAdvisorsView({ onBack }: ServiceAdvisorsViewProps) {
  const [advisors, setAdvisors] = useState<AdvisorListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdvisorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [newAdvisor, setNewAdvisor] = useState({ displayName: '', advisorCode: '' });

  const activeAdvisors = useMemo(
    () => advisors.filter((advisor) => advisor.status === 'active'),
    [advisors]
  );

  const loadAdvisors = useCallback(async () => {
    setLoading(true);
    try {
      const { advisors: list } = await api.listAdvisors();
      setAdvisors(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load service advisors');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const { advisor } = await api.getAdvisor(id);
      setDetail(advisor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load advisor profile');
      setSelectedId(null);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdvisors();
  }, [loadAdvisors]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const handleCreateAdvisor = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { advisor } = await api.createAdvisor({
        displayName: newAdvisor.displayName.trim(),
        advisorCode: newAdvisor.advisorCode.trim() || undefined,
      });
      toast.success('Service advisor added');
      setNewAdvisor({ displayName: '', advisorCode: '' });
      setShowCreateForm(false);
      await loadAdvisors();
      setSelectedId(advisor.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add service advisor');
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    try {
      await api.updateAdvisor(selectedId, { status: 'inactive' });
      toast.success('Service advisor deactivated');
      await loadAdvisors();
      await loadDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate advisor');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    try {
      await api.updateAdvisor(selectedId, { status: 'active' });
      toast.success('Service advisor reactivated');
      await loadAdvisors();
      await loadDetail(selectedId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reactivate advisor');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedId || !detail) return;
    const confirmed = window.confirm(
      `Remove ${detail.displayName} from Service Advisors?\n\nThey will be hidden from active lists. Their repair orders, stories, and audit history are preserved.`
    );
    if (!confirmed) return;

    setActionLoading(true);
    try {
      await api.deleteAdvisor(selectedId);
      toast.success('Service advisor removed');
      setSelectedId(null);
      setDetail(null);
      await loadAdvisors();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove advisor');
    } finally {
      setActionLoading(false);
    }
  };

  const selectedAdvisor = advisors.find((a) => a.id === selectedId);

  return (
    <div className="benz-page-compact">
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={() => {
            if (selectedId) {
              setSelectedId(null);
              return;
            }
            onBack();
          }}
          className="benz-icon-btn -ml-1 touch-target text-benz-blue"
          aria-label="Back"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="benz-dashboard-eyebrow text-left mb-0.5">Advisor Management</div>
          <h1 className="text-xl font-bold tracking-tight truncate">
            {selectedAdvisor ? selectedAdvisor.displayName : 'Service Advisors'}
          </h1>
          <p className="text-xs text-benz-secondary mt-0.5 leading-snug">
            {selectedAdvisor
              ? 'Performance metrics, profile & management'
              : 'Team roster, KPIs, and advisor intelligence'}
          </p>
        </div>
        {!selectedId ? (
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className={`secondary-btn text-xs h-9 px-3 flex items-center gap-1.5 font-medium shrink-0 ${showCreateForm ? 'benz-btn-accent-outline' : ''}`}
          >
            <UserPlus size={14} /> {showCreateForm ? 'Cancel' : 'Add advisor'}
          </button>
        ) : null}
      </div>

      {!selectedId && showCreateForm ? (
        <form onSubmit={handleCreateAdvisor} className="benz-card p-4 mb-4 benz-admin-form-panel space-y-3">
          <div className="benz-section-title mb-1">New service advisor</div>
          <input
            type="text"
            placeholder="Full name"
            value={newAdvisor.displayName}
            onChange={(e) => setNewAdvisor((prev) => ({ ...prev, displayName: e.target.value }))}
            className="benz-input"
            required
            minLength={3}
            maxLength={48}
          />
          <input
            type="text"
            placeholder="Advisor code (optional)"
            value={newAdvisor.advisorCode}
            onChange={(e) => setNewAdvisor((prev) => ({ ...prev, advisorCode: e.target.value }))}
            className="benz-input"
            maxLength={16}
          />
          <button type="submit" disabled={creating} className="primary-btn w-full h-11 text-sm disabled:opacity-50">
            {creating ? 'Adding…' : 'Add service advisor'}
          </button>
        </form>
      ) : null}

      {loading ? (
        <div className="benz-card p-6 text-sm text-benz-secondary">Loading advisors...</div>
      ) : selectedId ? (
        detailLoading || !detail ? (
          <div className="benz-card p-6 text-sm text-benz-secondary">Loading profile...</div>
        ) : (
          <AdvisorDetailPanel
            advisor={detail}
            actionLoading={actionLoading}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
            onRemove={handleRemove}
          />
        )
      ) : advisors.length === 0 ? (
        <BenzEmptyState
          icon={UserRound}
          title="No service advisors yet"
          hint="Add an advisor manually or scan repair orders with a Service Advisor name in the header. Profiles and metrics build automatically."
        />
      ) : (
        <div className="space-y-4">
          <div className="benz-card p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="benz-section-title mb-0">Team overview</div>
              <span className="text-xs text-benz-secondary">
                {activeAdvisors.length} active · {advisors.length} total
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-sm">
              <MetricTile
                label="Active advisors"
                value={String(activeAdvisors.length)}
              />
              <MetricTile
                label="ROs linked"
                value={formatMetricNumber(
                  advisors.reduce((sum, advisor) => sum + advisor.metrics.rosWritten, 0)
                )}
              />
            </div>
          </div>

          <div className="space-y-2.5">
            {advisors.map((advisor) => (
              <button
                key={advisor.id}
                onClick={() => setSelectedId(advisor.id)}
                className="benz-settings-nav"
              >
                <div className="min-w-0 text-left flex-1">
                  <div className="font-semibold text-sm truncate">
                    {advisor.displayName}
                    {advisor.status === 'inactive' ? (
                      <span className="text-benz-muted font-normal"> · inactive</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-benz-secondary mt-1">
                    {advisor.metrics.rosWritten} RO{advisor.metrics.rosWritten === 1 ? '' : 's'} ·{' '}
                    Approval {formatMetricPercent(advisor.metrics.approvalRate)} · Upsell{' '}
                    {formatMetricPercent(advisor.metrics.upsellRate)}
                  </div>
                  <div className="text-xs text-benz-muted">
                    Last seen {formatDate(advisor.lastSeenAt)}
                    {advisor.advisorCode ? ` · ${advisor.advisorCode}` : ''}
                  </div>
                </div>
                <ChevronRight size={18} className="text-benz-secondary shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}