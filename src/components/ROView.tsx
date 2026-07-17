'use client';

import { ChevronRight, ClipboardList, FileText, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { XentryDiagnosticSection } from '@/components/XentryDiagnosticSection';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import { hasSoldMetrics } from '@/lib/repairLineSoldMetrics';
import { SoldMetricsSummary } from '@/components/SoldMetricsSummary';
import { StableInput } from '@/components/StableInput';
import { StableTextarea } from '@/components/StableTextarea';
import type { ExtractedData, ImageAttachment, PendingImage, RepairOrder } from '../types';

interface ROViewProps {
  ro: RepairOrder;
  isProcessingOCR: boolean;
  ocrProgress: number;
  xentryStatusMessage: string;
  xentrySavedImages: ImageAttachment[];
  xentryPendingImages: PendingImage[];
  xentryImagesNeedingAnalysisCount: number;
  xentryExtractedData?: ExtractedData;
  onDone: () => void;
  onUpdateRONumber: (value: string) => void;
  onUpdateVehicle: (field: 'vin' | 'year' | 'make' | 'model' | 'engine' | 'mileageIn' | 'mileageOut', value: string) => void;
  onUpdateCustomer: (value: string) => void;
  onAddComplaint: () => void;
  onEditComplaint: (index: number, value: string) => void;
  onRemoveComplaint: (index: number) => void;
  onDecodeVin: () => void;
  onCaptureRoXentryPhoto: () => void;
  onAddRoXentryFromGallery: () => void;
  onProcessRoXentryImages: () => void;
  onClearPendingRoXentry: () => void;
  onCancelRoXentryProcessing: () => void;
  onDeletePendingRoXentryImage?: (imageId: string) => void;
  onDeleteROXentryImage: (imageId: string) => void;
  onAddRepairLine: () => void;
  onOpenLine: (lineId: string) => void;
  onDeleteRO: () => void;
}

function complaintLabel(labels: string[] | undefined, index: number): string {
  return labels?.[index] || String.fromCharCode(65 + index);
}

export function ROView({
  ro,
  isProcessingOCR,
  ocrProgress,
  xentryStatusMessage,
  xentrySavedImages,
  xentryPendingImages,
  xentryImagesNeedingAnalysisCount,
  xentryExtractedData,
  onDone,
  onUpdateRONumber,
  onUpdateVehicle,
  onUpdateCustomer,
  onAddComplaint,
  onEditComplaint,
  onRemoveComplaint,
  onDecodeVin,
  onCaptureRoXentryPhoto,
  onAddRoXentryFromGallery,
  onProcessRoXentryImages,
  onClearPendingRoXentry,
  onCancelRoXentryProcessing,
  onDeletePendingRoXentryImage,
  onDeleteROXentryImage,
  onAddRepairLine,
  onOpenLine,
  onDeleteRO,
}: ROViewProps) {
  const { t } = useTranslation('ro');
  const { t: tCommon } = useTranslation('common');
  const vehicleSummary =
    [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ') || tCommon('vehicle');
  const mileageStr = ro.vehicle.mileageIn
    ? `${ro.vehicle.mileageIn} ${tCommon('mileageUnit')}`
    : '';

  return (
    <div className="benz-page">
      <div className="benz-ro-header flex justify-between items-start gap-4">
        <div className="min-w-0">
          <div className="benz-ro-title">{ro.roNumber}</div>
          <div className="benz-ro-subtitle">{t('subtitle')}</div>
          {(ro.serviceAdvisor?.displayName || ro.serviceAdvisorName) && (
            <div className="benz-advisor-badge">
              {t('advisor', { name: ro.serviceAdvisor?.displayName || ro.serviceAdvisorName })}
            </div>
          )}
        </div>
        <button onClick={onDone} className="benz-link text-sm shrink-0 pt-1">
          {t('done')}
        </button>
      </div>

      <div className="benz-vehicle-bar benz-vehicle-bar-luxury mb-6">
        <div className="text-sm font-semibold tracking-tight text-benz-primary">
          {vehicleSummary}
          {mileageStr ? ` · ${mileageStr}` : ''}
          {ro.vehicle.vin ? ` · ${tCommon('vin')} ${ro.vehicle.vin}` : ''}
        </div>
        {ro.vehicle.engine && (
          <div className="text-xs text-benz-secondary mt-1">{t('engine', { engine: ro.vehicle.engine })}</div>
        )}
        {ro.customer?.name && (
          <div className="text-xs text-benz-secondary mt-1">{t('customer', { name: ro.customer.name })}</div>
        )}
      </div>

      <div className="benz-card p-5 sm:p-6 mb-6 space-y-4 min-w-0 w-full">
        <div>
          <div className="benz-section-title mb-1">{t('detailsTitle')}</div>
          <p className="benz-hint">{t('detailsHint')}</p>
        </div>

        <div>
          <label className="benz-label">{t('roNumber')}</label>
          <StableInput
            fieldKey={`${ro.id}-roNumber`}
            value={ro.roNumber}
            onChange={onUpdateRONumber}
            placeholder="RO-123456"
            className="benz-input benz-input-mono"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0">
            <label className="benz-label">{t('year')}</label>
            <StableInput
              fieldKey={`${ro.id}-year`}
              value={ro.vehicle.year}
              onChange={(v) => onUpdateVehicle('year', v)}
              placeholder="2023"
              className="benz-input"
            />
          </div>
          <div className="min-w-0">
            <label className="benz-label">{t('make')}</label>
            <StableInput
              fieldKey={`${ro.id}-make`}
              value={ro.vehicle.make}
              onChange={(v) => onUpdateVehicle('make', v)}
              placeholder="Mercedes-Benz"
              className="benz-input"
            />
          </div>
          <div className="min-w-0">
            <label className="benz-label">{t('model')}</label>
            <StableInput
              fieldKey={`${ro.id}-model`}
              value={ro.vehicle.model}
              onChange={(v) => onUpdateVehicle('model', v)}
              placeholder="GLE 450 4MATIC"
              className="benz-input"
            />
          </div>
          <div className="min-w-0">
            <label className="benz-label">{t('mileageIn')}</label>
            <StableInput
              fieldKey={`${ro.id}-mileageIn`}
              value={ro.vehicle.mileageIn}
              onChange={(v) => onUpdateVehicle('mileageIn', v)}
              placeholder="48250"
              className="benz-input"
            />
          </div>
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <label className="benz-label">{t('mileageOut')}</label>
            <StableInput
              fieldKey={`${ro.id}-mileageOut`}
              value={ro.vehicle.mileageOut}
              onChange={(v) => onUpdateVehicle('mileageOut', v)}
              placeholder="48280"
              className="benz-input"
            />
          </div>
        </div>

        <div>
          <label className="benz-label">{t('vin')}</label>
          <div className="flex gap-2 min-w-0">
            <StableInput
              fieldKey={`${ro.id}-vin`}
              value={ro.vehicle.vin}
              onChange={(v) => onUpdateVehicle('vin', v.toUpperCase())}
              placeholder="W1Nxxxx..."
              maxLength={17}
              className="benz-input benz-input-mono flex-1 min-w-0"
            />
            <button
              onClick={onDecodeVin}
              disabled={ro.vehicle.vin.length < 17}
              className="secondary-btn px-4 text-xs font-semibold whitespace-nowrap disabled:opacity-50 h-[42px]"
            >
              {t('decode')}
            </button>
          </div>
          <p className="benz-hint mt-1.5">{t('decodeHint')}</p>
        </div>

        <div>
          <label className="benz-label">{t('engineLabel')}</label>
          <StableInput
            fieldKey={`${ro.id}-engine`}
            value={ro.vehicle.engine || ''}
            onChange={(v) => onUpdateVehicle('engine', v)}
            placeholder={t('enginePlaceholder')}
            className="benz-input"
          />
        </div>

        <div>
          <label className="benz-label">{t('customerName')}</label>
          <StableInput
            fieldKey={`${ro.id}-customer`}
            value={ro.customer?.name || ''}
            onChange={onUpdateCustomer}
            placeholder={t('customerPlaceholder')}
            className="benz-input"
          />
        </div>

        <div className="benz-divider pt-5">
          <div className="benz-section-header">
            <div>
              <div className="benz-section-title">{t('complaintsTitle')}</div>
              <p className="benz-hint mt-1">{t('complaintsHint')}</p>
            </div>
            <button onClick={onAddComplaint} className="benz-link text-xs flex items-center gap-1 shrink-0">
              <Plus size={14} /> {t('addComplaint')}
            </button>
          </div>

          {ro.complaints && ro.complaints.length > 0 ? (
            <div className="space-y-3">
              {ro.complaints.map((c, idx) => {
                const label = complaintLabel(ro.complaintLabels, idx);
                const stableId = ro.complaintIds?.[idx] ?? `cmp-${ro.id}-${label}`;
                return (
                  <div key={stableId} className="benz-complaint-row">
                    <div className="benz-complaint-label">{label}.</div>
                    <div className="benz-complaint-field">
                      <StableTextarea
                        fieldKey={stableId}
                        value={c}
                        onChange={(v) => onEditComplaint(idx, v)}
                        placeholder={t('complaintPlaceholder')}
                        className="benz-textarea min-h-[52px]"
                      />
                    </div>
                    <button
                      onClick={() => onRemoveComplaint(idx)}
                      className="benz-danger-icon-btn mt-2"
                      title={t('removeComplaint')}
                      aria-label={t('removeComplaint')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <BenzEmptyState
              compact
              icon={ClipboardList}
              title={t('noComplaintsTitle')}
              hint={t('noComplaintsHint')}
              actionLabel={t('addComplaintAction')}
              onAction={onAddComplaint}
              className="mb-2"
            />
          )}
          <button onClick={onAddComplaint} className="benz-link text-xs mt-2">
            {t('addAnotherComplaint')}
          </button>
        </div>
      </div>

      <div className="mb-6">
        <XentryDiagnosticSection
          savedImages={xentrySavedImages}
          pendingImages={xentryPendingImages}
          imagesNeedingAnalysisCount={xentryImagesNeedingAnalysisCount}
          isProcessing={isProcessingOCR}
          ocrProgress={ocrProgress}
          statusMessage={xentryStatusMessage}
          extractedData={xentryExtractedData}
          onCapturePhoto={onCaptureRoXentryPhoto}
          onAddFromGallery={onAddRoXentryFromGallery}
          onProcessImages={onProcessRoXentryImages}
          onClearPending={onClearPendingRoXentry}
          onCancelProcessing={onCancelRoXentryProcessing}
          onDeletePendingImage={onDeletePendingRoXentryImage}
          onDeleteSavedImage={onDeleteROXentryImage}
        />
      </div>

      <div className="benz-section-header px-0.5">
        <div>
          <div className="text-sm font-semibold text-benz-silver tracking-wide">{t('repairLines')}</div>
          <p className="benz-hint mt-0.5">{t('repairLinesHint')}</p>
        </div>
        <button onClick={onAddRepairLine} className="benz-link text-sm flex items-center gap-1 font-semibold">
          <Plus size={16} /> {t('addLine')}
        </button>
      </div>

      <div className="space-y-2.5 mb-8">
        {ro.repairLines.map((line) => (
          <div
            key={line.id}
            onClick={() => onOpenLine(line.id)}
            className="benz-line-card flex justify-between items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-[15px] tracking-tight break-words leading-snug">
                {t('lineTitle', { number: line.lineNumber, description: line.description })}
              </div>
              {line.customerConcern && (
                <div className="text-xs text-benz-secondary mt-1 break-words leading-relaxed line-clamp-2">
                  {line.customerConcern}
                </div>
              )}
              {line.warrantyStory &&
                (isCustomerPayRepairLine(line) ? (
                  <span className="benz-story-badge benz-story-badge-cp benz-story-badge-compact mt-1.5">
                    <FileText size={12} aria-hidden />
                    {t('instantStory')}
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="benz-story-badge benz-story-badge-ai benz-story-badge-compact">
                      <Sparkles size={12} aria-hidden />
                      {t('aiStoryReady')}
                    </span>
                    {line.storyQualityAudit &&
                      isStoryQualityCurrent(line.storyQualityAudit, line.warrantyStory) && (
                        <span className="benz-story-badge benz-story-badge-compact text-benz-blue border-benz-blue/30 bg-benz-blue/10">
                          {t('miScore', { score: line.storyQualityAudit.score })}
                        </span>
                      )}
                    {line.storyCertification && (
                      <span className="benz-story-badge benz-story-badge-compact text-benz-green border-benz-green/30 bg-benz-green/10">
                        {t('certified')}
                      </span>
                    )}
                  </div>
                ))}
              {hasSoldMetrics(line.soldMetrics) && line.soldMetrics ? (
                <SoldMetricsSummary metrics={line.soldMetrics} compact />
              ) : null}
            </div>
            <ChevronRight size={20} className="text-benz-muted shrink-0" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <button onClick={onDone} className="w-full secondary-btn h-12 text-sm font-medium">
          {t('backToList')}
        </button>
        <button
          onClick={onDeleteRO}
          className="w-full benz-danger-btn h-12 flex items-center justify-center gap-2"
        >
          <Trash2 size={16} />
          {t('deleteRo')}
        </button>
      </div>
    </div>
  );
}
