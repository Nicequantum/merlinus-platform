'use client';

import { memo } from 'react';
import { ChevronRight, ClipboardList, Loader2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { StoryStatusBadge } from '@/components/StoryStatusBadge';
import { formatDisplayDate } from '@/lib/dateFormat';
import type { RepairOrderSummary } from '@/types';

interface RepairOrderListProps {
  repairOrders: RepairOrderSummary[];
  openingROId: string | null;
  onOpenRO: (ro: RepairOrderSummary) => void;
  onDeleteRO?: (id: string) => void;
  emptyMessage?: string;
  emptyHint?: string;
}

interface RepairOrderRowProps {
  ro: RepairOrderSummary;
  isThisOpening: boolean;
  isOpening: boolean;
  onOpenRO: (ro: RepairOrderSummary) => void;
  onDeleteRO?: (id: string) => void;
}

const RepairOrderRow = memo(function RepairOrderRow({
  ro,
  isThisOpening,
  isOpening,
  onOpenRO,
  onDeleteRO,
}: RepairOrderRowProps) {
  const { t } = useTranslation('common');
  const vehicleSummary = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ');
  const lineCount = ro.repairLines.length;

  return (
    <div
      role="button"
      tabIndex={isOpening && !isThisOpening ? -1 : 0}
      aria-busy={isThisOpening}
      aria-disabled={isOpening && !isThisOpening}
      onClick={() => {
        if (isOpening) return;
        onOpenRO(ro);
      }}
      onKeyDown={(e) => {
        if (isOpening) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpenRO(ro);
        }
      }}
      className={`benz-card p-4 flex justify-between items-center gap-3 transition-all duration-200 touch-manipulation select-none active:scale-[0.99] ${
        isThisOpening
          ? 'ring-2 ring-benz-accent/50 bg-benz-surface-2 cursor-wait'
          : isOpening
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer hover:border-benz-accent/25 hover:shadow-benz'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="font-bold text-sm tracking-tight">{ro.roNumber}</div>
        <div className="text-xs text-benz-secondary mt-1">
          {vehicleSummary || t('vehicleTbd')} · {t('lineCount', { count: lineCount })}
          {ro.technicianName ? ` · ${ro.technicianName}` : ''}
        </div>
        {ro.firstComplaintPreview && (
          <div className="text-xs text-benz-muted mt-1 truncate">
            {ro.firstComplaintPreview.slice(0, 72)}
            {ro.firstComplaintPreview.length > 72 ? '…' : ''}
          </div>
        )}
        {ro.createdAt && (
          <div className="text-xs text-benz-muted mt-1 opacity-90">{formatDisplayDate(ro.createdAt)}</div>
        )}
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
        {isThisOpening ? (
          <Loader2 size={20} className="text-benz-blue animate-spin" aria-label={t('loadingRoAria')} />
        ) : (
          <>
            <StoryStatusBadge lines={ro.repairLines} compact />
            <ChevronRight size={20} className="text-benz-muted" aria-hidden="true" />
          </>
        )}
        {onDeleteRO && !isThisOpening && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isOpening) return;
              onDeleteRO(ro.id);
            }}
            className="benz-danger-icon-btn flex items-center gap-1 text-xs font-medium px-2"
            aria-label={t('deleteRoAria', { roNumber: ro.roNumber })}
          >
            <Trash2 size={14} />
            {t('delete')}
          </button>
        )}
      </div>
    </div>
  );
});

export function RepairOrderList({
  repairOrders,
  openingROId,
  onOpenRO,
  onDeleteRO,
  emptyMessage,
  emptyHint,
}: RepairOrderListProps) {
  const { t } = useTranslation('home');

  if (repairOrders.length === 0) {
    return (
      <BenzEmptyState
        icon={ClipboardList}
        title={emptyMessage ?? t('emptyDefault')}
        hint={emptyHint ?? t('emptyDefaultHint')}
      />
    );
  }

  const isOpening = openingROId !== null;

  return (
    <div className="space-y-2.5">
      {repairOrders.map((ro) => (
        <RepairOrderRow
          key={ro.id}
          ro={ro}
          isThisOpening={openingROId === ro.id}
          isOpening={isOpening}
          onOpenRO={onOpenRO}
          onDeleteRO={onDeleteRO}
        />
      ))}
    </div>
  );
}
