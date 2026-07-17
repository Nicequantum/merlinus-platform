'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, Users } from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { UsageAnalytics } from '@/types';
import { DealershipBranding } from '@/components/DealershipBranding';

interface UsageDashboardViewProps {
  dealershipName: string;
  onBackHref?: string;
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

export function UsageDashboardView({ dealershipName, onBackHref = '/' }: UsageDashboardViewProps) {
  const [analytics, setAnalytics] = useState<UsageAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getUsageAnalytics();
      setAnalytics(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load usage analytics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  return (
    <div className="app-container benz-app-wide benz-page-compact">
      <div className="relative pt-2 mb-6">
        <Link href={onBackHref} className="absolute top-2 left-0 benz-icon-btn touch-target" aria-label="Back">
          <ArrowLeft size={22} />
        </Link>
        <p className="benz-dashboard-eyebrow">Usage Analytics</p>
        <DealershipBranding size="md" displayName={dealershipName} />
        <p className="text-xs text-benz-secondary mt-3 text-center">{dealershipName}</p>
      </div>

      {loading ? (
        <div className="benz-card p-8 text-sm text-benz-secondary text-center">Loading usage metrics…</div>
      ) : analytics ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <StatCard label="Today's AI Calls" value={analytics.totalDailyUsage} icon={<Activity size={14} />} />
            <StatCard label="Daily Limit" value={analytics.dailyLimit} icon={<BarChart3 size={14} />} accent="text-benz-amber" />
          </div>

          <div className="benz-card p-5 mb-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="benz-avatar text-benz-blue">
                <Users size={18} />
              </div>
              <div>
                <div className="font-semibold text-sm tracking-tight">Technician Usage</div>
                <div className="benz-hint mt-0.5">Sorted by today&apos;s AI API calls</div>
              </div>
            </div>

            {analytics.technicians.length === 0 ? (
              <BenzEmptyState
                icon={Users}
                title="No usage recorded yet"
                hint="AI call counts will appear here once technicians generate stories or run OCR."
                compact
              />
            ) : (
              <div className="space-y-2.5">
                {analytics.technicians.map((tech) => {
                  const atLimit = tech.dailyCount >= analytics.dailyLimit;
                  return (
                    <div key={tech.technicianId} className="benz-list-row px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate tracking-tight">{tech.name}</div>
                          <div className="text-xs text-benz-secondary mt-0.5">
                            {tech.d7Number} · {tech.role}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold ${atLimit ? 'text-benz-red' : 'text-benz-green'}`}>
                            {tech.dailyCount} today
                          </div>
                          <div className="text-xs text-benz-muted">{tech.weeklyCount} this week</div>
                        </div>
                      </div>
                      <div className="benz-progress-track mt-3">
                        <div
                          className={`h-full rounded-full transition-all ${atLimit ? 'bg-benz-red' : 'bg-gradient-to-r from-benz-blue-dim to-benz-blue'}`}
                          style={{
                            width: `${Math.min(100, (tech.dailyCount / analytics.dailyLimit) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="benz-hint leading-relaxed px-1">
            Tracks AI extraction and warranty story API calls. Each technician is limited to {analytics.dailyLimit}{' '}
            requests per day.
          </p>
        </>
      ) : null}
    </div>
  );
}