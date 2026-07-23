'use client';

import { Settings, Video, Wrench, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ApexLogoMark } from '@/components/apex/ApexLogoMark';
import { DealershipBranding } from '@/components/DealershipBranding';
import { PullToRefresh } from '@/components/PullToRefresh';
import { RepairOrderHomeLists } from '@/components/RepairOrderHomeLists';
import { ScanROSection } from '@/components/ScanROSection';
import { RoListSkeleton } from '@/components/RoListSkeleton';
import type { PendingImage, RepairOrderSummary } from '../types';

interface HomeViewProps {
  technicianName?: string;
  /** Session rooftop name from provision (`Dealership.name`). */
  dealershipName?: string | null;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  searchLoading: boolean;
  searchROs: RepairOrderSummary[];
  todayROs: RepairOrderSummary[];
  previousROs: RepairOrderSummary[];
  previousExpanded: boolean;
  onTogglePrevious: () => void;
  previousLoading: boolean;
  previousLoadingMore: boolean;
  previousHasMore: boolean;
  onLoadMorePrevious: () => void;
  pendingROImages: PendingImage[];
  isProcessingOCR: boolean;
  ocrProgress: number;
  scanStatusMessage: string;
  onScanRO: () => void;
  onAddFromGallery: () => void;
  onProcessScan: () => void;
  onClearPendingScan: () => void;
  onCancelScan: () => void;
  onDeletePendingPage?: (imageId: string) => void;
  onCreateManualRO: () => void;
  openingROId: string | null;
  onOpenRO: (ro: RepairOrderSummary) => void;
  onDeleteRO: (id: string) => void;
  onOpenSettings: () => void;
  onOpenVideoInspection?: () => void;
  onOpenMaintenance?: () => void;
  /** Pull-to-refresh / retry list */
  onRefreshList?: () => void | Promise<void>;
  listLoading?: boolean;
  listValidating?: boolean;
  listFromCache?: boolean;
  listError?: string | null;
  onRetryList?: () => void;
}

export function HomeView({
  technicianName,
  dealershipName,
  searchTerm,
  onSearchChange,
  searchLoading,
  searchROs,
  todayROs,
  previousROs,
  previousExpanded,
  onTogglePrevious,
  previousLoading,
  previousLoadingMore,
  previousHasMore,
  onLoadMorePrevious,
  pendingROImages,
  isProcessingOCR,
  ocrProgress,
  scanStatusMessage,
  onScanRO,
  onAddFromGallery,
  onProcessScan,
  onClearPendingScan,
  onCancelScan,
  onDeletePendingPage,
  onCreateManualRO,
  openingROId,
  onOpenRO,
  onDeleteRO,
  onOpenSettings,
  onOpenVideoInspection,
  onOpenMaintenance,
  onRefreshList,
  listLoading,
  listValidating,
  listFromCache,
  listError,
  onRetryList,
}: HomeViewProps) {
  const { t } = useTranslation('home');
  const { t: tVideo } = useTranslation('video');

  return (
    <div className="relative min-h-dvh benz-page-compact benz-bay-shell desktop-home-layout">
      <div className="absolute top-4 right-4 z-10 flex items-center gap-1 desktop-home-chrome">
        {onOpenMaintenance ? (
          <button
            type="button"
            onClick={onOpenMaintenance}
            className="benz-icon-btn touch-target touch-target-bay"
            aria-label={t('maintenance')}
            title={t('maintenance')}
          >
            <Wrench size={22} />
          </button>
        ) : null}
        {onOpenVideoInspection ? (
          <button
            type="button"
            onClick={onOpenVideoInspection}
            className="benz-icon-btn touch-target touch-target-bay"
            aria-label={tVideo('navLabel')}
            title={tVideo('navLabel')}
          >
            <Video size={22} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenSettings}
          className="benz-icon-btn touch-target"
          aria-label={t('settingsAria')}
        >
          <Settings size={22} />
        </button>
      </div>

      <div className="pt-10 desktop-home-body">
        <div className="merlin-brand-hero mb-8 desktop-home-hero">
          <ApexLogoMark size="lg" className="mb-1" title="Apex" />
          <div className="merlin-brand-divider" aria-hidden="true" />
          <DealershipBranding size="lg" className="mb-2" displayName={dealershipName} />
          <p className="text-benz-secondary text-sm font-medium">
            {technicianName || t('technicianFallback')}
          </p>
          <div className="flex flex-wrap gap-2 mt-4 justify-center desktop-home-quick-actions">
            {onOpenVideoInspection ? (
              <button
                type="button"
                className="secondary-btn h-11 px-4 touch-target"
                onClick={onOpenVideoInspection}
              >
                <Video size={16} className="inline mr-2" />
                {tVideo('navLabel')}
              </button>
            ) : null}
            {onOpenMaintenance ? (
              <button
                type="button"
                className="secondary-btn h-11 px-4 touch-target"
                onClick={onOpenMaintenance}
              >
                <Wrench size={16} className="inline mr-2" />
                {t('maintenance')}
              </button>
            ) : null}
          </div>
        </div>

        <div className="desktop-home-scan">
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
          scanButtonLabel={t('scanRo')}
        />
        </div>

        <div className="mb-4 desktop-home-lists">
          <input
            type="search"
            enterKeyHint="search"
            placeholder={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="benz-search touch-target-bay"
            aria-label={t('searchPlaceholder')}
          />
        </div>

        {listError && todayROs.length === 0 && !listLoading ? (
          <div className="benz-card p-4 mb-4 text-center space-y-2">
            <p className="text-sm text-benz-secondary">{listError}</p>
            {onRetryList ? (
              <button
                type="button"
                className="primary-btn h-11 px-5 touch-target-bay text-sm font-semibold"
                onClick={onRetryList}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {listFromCache && listValidating ? (
          <div className="flex items-center justify-center gap-2 text-[11px] text-benz-muted mb-2" aria-live="polite">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Updating list…
          </div>
        ) : null}

        <PullToRefresh
          onRefresh={async () => {
            if (onRefreshList) await onRefreshList();
          }}
          disabled={Boolean(searchTerm.trim()) || listLoading}
        >
          {listLoading && todayROs.length === 0 ? (
            <RoListSkeleton rows={4} />
          ) : (
            <RepairOrderHomeLists
              searchTerm={searchTerm}
              searchLoading={searchLoading}
              searchResults={searchROs}
              todayROs={todayROs}
              previousROs={previousROs}
              previousExpanded={previousExpanded}
              onTogglePrevious={onTogglePrevious}
              previousLoading={previousLoading}
              previousLoadingMore={previousLoadingMore}
              previousHasMore={previousHasMore}
              onLoadMorePrevious={onLoadMorePrevious}
              openingROId={openingROId}
              onOpenRO={onOpenRO}
              onDeleteRO={onDeleteRO}
            />
          )}
        </PullToRefresh>
      </div>
    </div>
  );
}
