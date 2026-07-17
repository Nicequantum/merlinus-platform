'use client';

import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { RepairOrderList } from '@/components/RepairOrderList';
import type { RepairOrderSummary } from '@/types';

interface PreviousRepairOrdersSectionProps {
  repairOrders: RepairOrderSummary[];
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  openingROId: string | null;
  onOpenRO: (ro: RepairOrderSummary) => void;
  onDeleteRO?: (id: string) => void;
}

export function PreviousRepairOrdersSection({
  repairOrders,
  expanded,
  onToggle,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  openingROId,
  onOpenRO,
  onDeleteRO,
}: PreviousRepairOrdersSectionProps) {
  const { t } = useTranslation('home');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!expanded || !hasMore || loading || loadingMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMore();
        }
      },
      { rootMargin: '120px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, hasMore, loading, loadingMore, onLoadMore]);

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 rounded-xl border border-benz-border bg-benz-surface-2 px-4 py-3 text-left transition-colors hover:border-benz-border-accent touch-target"
      >
        <div>
          <div className="benz-section-title px-0">{t('previousSection')}</div>
          <p className="text-xs text-benz-muted mt-1">
            {expanded ? t('previousExpandedHint') : t('previousCollapsedHint')}
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={20} className="text-benz-muted shrink-0" aria-hidden />
        ) : (
          <ChevronDown size={20} className="text-benz-muted shrink-0" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="mt-3">
          {loading && repairOrders.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-benz-secondary">
              <Loader2 size={18} className="animate-spin text-benz-blue" aria-hidden />
              {t('loadingPrevious')}
            </div>
          ) : (
            <>
              <RepairOrderList
                repairOrders={repairOrders}
                openingROId={openingROId}
                onOpenRO={onOpenRO}
                onDeleteRO={onDeleteRO}
                emptyMessage={t('noPrevious')}
                emptyHint={t('noPreviousHint')}
              />
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 py-4 text-xs text-benz-secondary">
                  <Loader2 size={16} className="animate-spin text-benz-blue" aria-hidden />
                  {t('loadingMore')}
                </div>
              )}
              {hasMore && !loadingMore && <div ref={sentinelRef} className="h-4" aria-hidden />}
              {hasMore && !loadingMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="w-full mt-2 py-2.5 text-sm font-medium text-benz-blue rounded-lg border border-benz-border hover:border-benz-border-accent touch-target"
                >
                  {t('loadMore')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
