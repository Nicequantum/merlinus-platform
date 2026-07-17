'use client';

import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PreviousRepairOrdersSection } from '@/components/PreviousRepairOrdersSection';
import { RepairOrderList } from '@/components/RepairOrderList';
import type { RepairOrderSummary } from '@/types';

interface RepairOrderHomeListsProps {
  searchTerm: string;
  searchLoading: boolean;
  searchResults: RepairOrderSummary[];
  todayROs: RepairOrderSummary[];
  previousROs: RepairOrderSummary[];
  previousExpanded: boolean;
  onTogglePrevious: () => void;
  previousLoading: boolean;
  previousLoadingMore: boolean;
  previousHasMore: boolean;
  onLoadMorePrevious: () => void;
  openingROId: string | null;
  onOpenRO: (ro: RepairOrderSummary) => void;
  onDeleteRO?: (id: string) => void;
}

export function RepairOrderHomeLists({
  searchTerm,
  searchLoading,
  searchResults,
  todayROs,
  previousROs,
  previousExpanded,
  onTogglePrevious,
  previousLoading,
  previousLoadingMore,
  previousHasMore,
  onLoadMorePrevious,
  openingROId,
  onOpenRO,
  onDeleteRO,
}: RepairOrderHomeListsProps) {
  const { t } = useTranslation('home');
  const isSearching = searchTerm.trim().length > 0;

  if (isSearching) {
    return (
      <div>
        <div className="benz-section-title mb-3 px-0.5">{t('searchResults')}</div>
        {searchLoading && searchResults.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-benz-secondary">
            <Loader2 size={18} className="animate-spin text-benz-blue" aria-hidden />
            {t('searchingRos')}
          </div>
        ) : (
          <RepairOrderList
            repairOrders={searchResults}
            openingROId={openingROId}
            onOpenRO={onOpenRO}
            onDeleteRO={onDeleteRO}
            emptyMessage={t('noSearchMatch')}
            emptyHint={t('noSearchHint')}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <div className="benz-section-title mb-3 px-0.5">{t('todaysRepairOrders')}</div>
      <RepairOrderList
        repairOrders={todayROs}
        openingROId={openingROId}
        onOpenRO={onOpenRO}
        onDeleteRO={onDeleteRO}
        emptyMessage={t('noTodayYet')}
        emptyHint={t('noTodayHint')}
      />
      <PreviousRepairOrdersSection
        repairOrders={previousROs}
        expanded={previousExpanded}
        onToggle={onTogglePrevious}
        loading={previousLoading}
        loadingMore={previousLoadingMore}
        hasMore={previousHasMore}
        onLoadMore={onLoadMorePrevious}
        openingROId={openingROId}
        onOpenRO={onOpenRO}
        onDeleteRO={onDeleteRO}
      />
    </>
  );
}
