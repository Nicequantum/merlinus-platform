'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  BookmarkPlus,
  Copy,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StableInput } from '@/components/StableInput';
import { StableTextarea } from '@/components/StableTextarea';
import { XentryDiagnosticSection } from '@/components/XentryDiagnosticSection';
import { SaveTemplateModal } from '@/components/SaveTemplateModal';
import {
  StoryQualityLoadingPanel,
  StoryQualityPanel,
  StoryQualityStaleBanner,
} from '@/components/StoryQualityPanel';
import { SoldMetricsSummary } from '@/components/SoldMetricsSummary';
import { TemplateLibraryModal } from '@/components/TemplateLibraryModal';
import { hasSoldMetrics } from '@/lib/repairLineSoldMetrics';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import { StoryComplianceIndicator } from '@/components/StoryComplianceIndicator';
import { TechnicianCertificationSection } from '@/components/TechnicianCertificationSection';
import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import type {
  ImageAttachment,
  PendingImage,
  RepairLine,
  RepairOrder,
  StoryQualityResult,
  StoryReviewResult,
  TechnicianDetailPrompt,
  TemplateCategory,
} from '@/types';

import { useLineViewCertificationForm } from '@/hooks/lineView/useLineViewCertificationForm';
import { useLineViewPdfExport } from '@/hooks/lineView/useLineViewPdfExport';
import { useStoryGenerationPhase } from '@/hooks/useStoryGenerationPhase';
import {
  complaintLabel,
  getWarrantyStoryTextareaValue,
  readWarrantyStoryText,
} from '@/lib/lineViewUtils';
import { copyFormattedStory } from '@/utils/pdfExport';
import {
  applyAllTechnicianDetails,
  applyTechnicianDetail,
} from '@/lib/applyTechnicianDetails';
import { MI_PRODUCT_LABEL } from '@/lib/grokModels';

interface LineViewProps {
  ro: RepairOrder;
  line: RepairLine;
  technicianName?: string;
  isProcessingOCR: boolean;
  ocrProgress: number;
  isGenerating: boolean;
  isScoring: boolean;
  isReviewing: boolean;
  storyQuality: StoryQualityResult | null;
  storyReview: StoryReviewResult | null;
  storyQualityStale: boolean;
  storyCertification: StoryCertificationRecord | null;
  isCertifyingStory: boolean;
  lastGeneratedStoryText: string | null;
  cdkSanitizedNotice?: boolean;
  onClearCdkSanitizedNotice?: () => void;
  onBack: () => void;
  onUpdateLine: (updates: Partial<RepairLine>, options?: { immediate?: boolean }) => void;
  xentrySavedImages: ImageAttachment[];
  xentryPendingImages: PendingImage[];
  xentryImagesNeedingAnalysisCount: number;
  xentryStatusMessage: string;
  onCaptureXentryPhoto: () => void;
  onAddXentryFromGallery: () => void;
  onProcessXentryImages: () => void;
  onClearPendingXentry: () => void;
  onCancelXentryProcessing: () => void;
  onDeletePendingXentryImage?: (imageId: string) => void;
  onDeleteXentryImage: (imageId: string) => void;
  onGenerateStory: () => void;
  onScoreStory: (storyText?: string) => void | Promise<void>;
  onReviewStory: (storyText?: string) => void | Promise<void>;
  onApplyCustomerPayTemplate: (templateId: string) => void | Promise<void>;
  onClearCustomerPayMode?: () => void | Promise<void>;
  onAcknowledgeStoryBaseline: (text: string) => void;
  onCertifyAndSaveStory: (storyText: string, certifiedByName: string) => void | Promise<void>;
}

export function LineView({
  ro,
  line,
  technicianName,
  isProcessingOCR,
  ocrProgress,
  isGenerating,
  isScoring,
  isReviewing,
  storyQuality,
  storyReview,
  storyQualityStale,
  storyCertification,
  isCertifyingStory,
  lastGeneratedStoryText,
  cdkSanitizedNotice = false,
  onClearCdkSanitizedNotice,
  onBack,
  onUpdateLine,
  xentrySavedImages,
  xentryPendingImages,
  xentryImagesNeedingAnalysisCount,
  xentryStatusMessage,
  onCaptureXentryPhoto,
  onAddXentryFromGallery,
  onProcessXentryImages,
  onClearPendingXentry,
  onCancelXentryProcessing,
  onDeletePendingXentryImage,
  onDeleteXentryImage,
  onGenerateStory,
  onScoreStory,
  onReviewStory,
  onApplyCustomerPayTemplate,
  onClearCustomerPayMode,
  onAcknowledgeStoryBaseline,
  onCertifyAndSaveStory,
}: LineViewProps) {
  const { t } = useTranslation('line');
  const { t: tCommon } = useTranslation('common');
  const isCustomerPayLine = isCustomerPayRepairLine(line);
  const vehicleSummary =
    [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ') || t('vehicleFallback');
  const mileageStr = ro.vehicle.mileageIn
    ? `${ro.vehicle.mileageIn} ${tCommon('mileageUnit')}`
    : '';
  const storyLen = line.warrantyStory?.length ?? 0;
  const generationPhase = useStoryGenerationPhase(isGenerating);
  const advisorName = ro.serviceAdvisor?.displayName || ro.serviceAdvisorName;
  const [showTemplateLibrary, setShowTemplateLibrary] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [libraryRefreshKey, setLibraryRefreshKey] = useState(0);

  const {
    certificationChecked,
    setCertificationChecked,
    certificationName,
    setCertificationName,
    showCertificationSection,
    certificationPendingReaudit,
    isStoryCertified,
    isCertificationComplete,
    certificationActionsLocked,
    storyComplianceState,
  } = useLineViewCertificationForm({
    lineId: line.id,
    isCustomerPayLine,
    technicianName,
    hasWarrantyStory: Boolean(line.warrantyStory?.trim()),
    storyQuality,
    storyQualityStale,
    storyCertification,
    lastGeneratedStoryText,
  });

  useEffect(() => {
    setShowSaveTemplate(false);
    setShowTemplateLibrary(false);
  }, [line.id]);

  const canSaveAsTemplate = useMemo(() => {
    return Boolean(lastGeneratedStoryText && line.warrantyStory?.trim());
  }, [lastGeneratedStoryText, line.warrantyStory]);

  const defaultTemplateTitle = useMemo(() => {
    const base = line.description?.trim() || t('defaultTemplateTitle');
    return base.length > 80 ? `${base.slice(0, 77)}…` : base;
  }, [line.description, t]);

  const handleApplyTechnicianDetail = (detail: TechnicianDetailPrompt) => {
    const patch = applyTechnicianDetail(line, detail);
    if (Object.keys(patch).length === 0) {
      toast.message(t('nothingToAdd'));
      return;
    }
    // Immediate persist so regenerate (server) sees notes + story corrections.
    onUpdateLine(patch, { immediate: true });
    toast.success(t('detailWoven'));
  };

  const handleApplyAllTechnicianDetails = (details: TechnicianDetailPrompt[]) => {
    const patch = applyAllTechnicianDetails(line, details);
    if (Object.keys(patch).length === 0) {
      toast.message(t('detailsAlreadyIn'));
      return;
    }
    onUpdateLine(patch, { immediate: true });
    toast.success(t('detailsWoven', { count: details.length }));
  };

  const handleInsertTemplate = (content: string, _title: string, category: TemplateCategory) => {
    // Warranty templates append to the story field — Customer Pay uses onApplyCustomerPayTemplate instead.
    if (category === 'customer') return;
    const existing = line.warrantyStory?.trim();
    const next = existing ? `${existing}\n\n${content}` : content;
    onUpdateLine({ warrantyStory: next });
  };

  const handleCopy = async () => {
    if (certificationActionsLocked) {
      if (!isCustomerPayLine && storyComplianceState === 'not-audited') {
        toast.error(t('runAuditBeforeCopy'));
      } else if (!isCustomerPayLine && storyComplianceState === 'audit-stale') {
        toast.error(t('rerunAuditBeforeCopy'));
      } else if (!isCustomerPayLine && !isStoryCertified) {
        toast.error(t('certifyBeforeCopy'));
      }
      return;
    }
    const storyText = getWarrantyStoryTextareaValue(line.id, line.warrantyStory);
    if (!storyText.trim()) return;
    try {
      const { wasModified } = await copyFormattedStory(ro, line, storyText);
      if (wasModified) {
        toast.message(t('storyCleanedCdk'));
      }
      toast.success(t('storyCopied'));
    } catch {
      toast.error(t('clipboardFailed'));
    }
  };

  const readStoryText = () => readWarrantyStoryText(line.id, line.warrantyStory);

  const handleGenerateStory = () => {
    void onGenerateStory();
  };

  const handleScoreStory = () => {
    void onScoreStory(readStoryText());
  };

  const handleReviewStory = () => {
    void onReviewStory(readStoryText());
  };

  const handleCertifyAndSave = () => {
    if (!isCertificationComplete || isStoryCertified || certificationPendingReaudit) return;
    void onCertifyAndSaveStory(readStoryText(), certificationName.trim());
  };

  const handlePdf = useLineViewPdfExport({ ro, line, technicianName, isCustomerPayLine });

  return (
    <div className="benz-page pb-12">
      <button onClick={onBack} className="benz-nav-back">
        <ArrowLeft size={18} /> {t('backToRo')}
      </button>

      <div className="benz-vehicle-bar benz-vehicle-bar-luxury mb-8">
        <div className="text-sm font-semibold tracking-tight text-benz-primary">
          {vehicleSummary}
          {mileageStr ? ` · ${mileageStr}` : ''}
          {ro.vehicle.vin ? ` · ${tCommon('vin')} ${ro.vehicle.vin.slice(0, 10)}…` : ''}
        </div>
        {ro.vehicle.engine && (
          <div className="text-xs text-benz-secondary mt-1">
            {tCommon('engine')}: {ro.vehicle.engine}
          </div>
        )}
        {ro.complaints && ro.complaints.length > 0 && (
          <div className="mt-2 text-xs text-benz-secondary leading-relaxed">
            {t('complaints')}:{' '}
            {ro.complaints
              .map((c, i) => `${complaintLabel(ro.complaintLabels, i)}. ${c.slice(0, 42)}${c.length > 42 ? '…' : ''}`)
              .join('  ')}
          </div>
        )}
      </div>

      <div className="mb-6">
        <label className="benz-label mb-2">{t('descriptionLabel', { number: line.lineNumber })}</label>
        <div className="benz-line-title-field flex gap-2 items-center min-w-0">
          <StableInput
            fieldKey={`${line.id}-description`}
            value={line.description}
            onChange={(v) => onUpdateLine({ description: v })}
            showVoice
            placeholder={t('descriptionPlaceholder')}
            className="benz-line-title-input flex-1 min-w-0"
          />
        </div>
      </div>

      <div className="benz-line-flow">
        <div className="benz-card benz-line-doc-card min-w-0 w-full">
          <label className="benz-label">{t('concernLabel')}</label>
          <p className="benz-hint mb-3">{t('concernHint')}</p>
          <div className="benz-complaint-field">
            <StableTextarea
              fieldKey={`${line.id}-concern`}
              value={line.customerConcern}
              onChange={(v) => onUpdateLine({ customerConcern: v })}
              voiceDictationMode="story"
              className="benz-textarea min-h-[80px]"
              placeholder={t('concernPlaceholder')}
            />
          </div>

          <div className="benz-line-doc-divider" />

          <label className="benz-label">{t('notesLabel')}</label>
          <p className="benz-hint mb-2 text-xs opacity-90">{t('storyEnglishOnly')}</p>
          <div className="benz-complaint-field">
            <StableTextarea
              fieldKey={`${line.id}-notes`}
              value={line.technicianNotes}
              onChange={(v) => onUpdateLine({ technicianNotes: v })}
              voiceDictationMode="story"
              className="benz-textarea min-h-[100px]"
              placeholder={t('notesPlaceholder')}
            />
          </div>
        </div>

        <XentryDiagnosticSection
          title={t('diagnosticTitle')}
          hint={t('diagnosticHint')}
          savedImages={xentrySavedImages}
          pendingImages={xentryPendingImages}
          imagesNeedingAnalysisCount={xentryImagesNeedingAnalysisCount}
          isProcessing={isProcessingOCR}
          ocrProgress={ocrProgress}
          statusMessage={xentryStatusMessage}
          extractedData={line.extractedData}
          onCapturePhoto={onCaptureXentryPhoto}
          onAddFromGallery={onAddXentryFromGallery}
          onProcessImages={onProcessXentryImages}
          onClearPending={onClearPendingXentry}
          onCancelProcessing={onCancelXentryProcessing}
          onDeletePendingImage={onDeletePendingXentryImage}
          onDeleteSavedImage={onDeleteXentryImage}
        />

        {advisorName && (
          <div className="benz-line-aside border-benz-accent/25 bg-benz-accent/5">
            <div className="flex items-center gap-2 text-benz-blue text-xs font-semibold">
              <Sparkles size={14} />
              {t('advisorIntelTitle')}
            </div>
            <p className="text-xs text-benz-secondary mt-2 leading-relaxed">
              {t('advisorIntelBody', { name: advisorName })}
            </p>
          </div>
        )}

        {hasSoldMetrics(line.soldMetrics) && line.soldMetrics ? (
          <SoldMetricsSummary metrics={line.soldMetrics} />
        ) : null}

        <div className="benz-generate-panel space-y-3 relative z-[5]">
          {isCustomerPayLine ? (
            <div className="benz-cp-instant-banner flex items-start gap-3 p-4 rounded-xl border border-benz-green/30 bg-benz-green/8">
              <Zap size={20} className="text-benz-green shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-benz-primary">{t('cpInstantTitle')}</div>
                <p className="text-xs text-benz-secondary mt-1 leading-relaxed">{t('cpInstantBody')}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleGenerateStory}
                disabled={isGenerating || isScoring || isReviewing}
                className="primary-btn w-full h-13 text-base flex items-center justify-center gap-2.5 disabled:opacity-50 touch-target"
              >
                {isGenerating ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    {generationPhase.message}
                  </>
                ) : (
                  t('generateMi', { mi: MI_PRODUCT_LABEL })
                )}
              </button>
              {isGenerating && (
                <div className="benz-gen-progress" role="progressbar" aria-valuenow={Math.round(generationPhase.progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="benz-gen-progress-bar" style={{ width: `${generationPhase.progress}%` }} />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={() => setShowTemplateLibrary(true)}
              disabled={isGenerating || isScoring || isReviewing}
              className="benz-tertiary-link disabled:opacity-50"
            >
              {isCustomerPayLine ? t('changeCpTemplate') : t('browseTemplates')}
            </button>
            {isCustomerPayLine && onClearCustomerPayMode && (
              <div className="benz-cp-switch-banner w-full">
                <p className="text-xs text-benz-secondary leading-relaxed">{t('needWarrantyNarrative')}</p>
                <button
                  type="button"
                  onClick={() => void onClearCustomerPayMode()}
                  disabled={isGenerating || isScoring || isReviewing}
                  className="secondary-btn benz-btn-accent-outline h-10 w-full mt-2 text-sm font-medium disabled:opacity-50"
                >
                  {t('switchToWarrantyAi')}
                </button>
              </div>
            )}
            {canSaveAsTemplate && lastGeneratedStoryText && (
              <button
                type="button"
                onClick={() => setShowSaveTemplate(true)}
                disabled={isGenerating || isScoring || isReviewing}
                className="benz-tertiary-link text-benz-green disabled:opacity-50"
              >
                {t('saveAsTemplate')}
              </button>
            )}
          </div>

          <p className="benz-hint text-center">
            {isCustomerPayLine
              ? t('cpTemplatesHint')
              : t('generateHint', { mi: MI_PRODUCT_LABEL })}
          </p>
          {isGenerating && !isCustomerPayLine && !line.warrantyStory?.trim() && (
            <StoryQualityLoadingPanel
              mode="generating"
              statusMessage={generationPhase.message}
              progress={generationPhase.progress}
            />
          )}
        </div>

        {!line.warrantyStory?.trim() && (
          <BenzEmptyState
            icon={isCustomerPayLine ? Zap : Sparkles}
            title={isCustomerPayLine ? t('noCpStoryTitle') : t('noWarrantyStoryTitle')}
            hint={isCustomerPayLine ? t('noCpStoryHint') : t('noWarrantyStoryHint')}
            actionLabel={
              isCustomerPayLine ? t('browseCpTemplates') : t('generateMi', { mi: MI_PRODUCT_LABEL })
            }
            onAction={() => (isCustomerPayLine ? setShowTemplateLibrary(true) : handleGenerateStory())}
            className="benz-story-empty-state"
          />
        )}

        {line.warrantyStory && (
          <div className={`story-card p-5 sm:p-6 min-w-0 w-full ${isCustomerPayLine ? 'story-card-cp' : ''}`}>
            <div className="flex justify-between items-start gap-3 mb-4 min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="benz-section-title tracking-[0.12em]">
                  {isCustomerPayLine ? t('cpStoryTitle') : t('warrantyStoryTitle')}
                </div>
                {isCustomerPayLine && (
                  <span className="benz-cp-badge">
                    <FileText size={12} /> {t('cpBadge')}
                  </span>
                )}
              </div>
              {storyLen > 0 && (
                <div className="text-xs font-mono font-medium text-benz-muted">
                  {tCommon('characters', { count: storyLen.toLocaleString() })}
                </div>
              )}
            </div>
            {cdkSanitizedNotice && (
              <div className="text-xs text-benz-amber mb-3 bg-benz-amber/10 border border-benz-amber/25 rounded-lg px-3 py-2">
                {t('storyCleanedCdk')}
              </div>
            )}
            <div className="benz-complaint-field">
              <StableTextarea
                id={`warranty-story-${line.id}`}
                fieldKey={`${line.id}-story`}
                value={line.warrantyStory}
                voiceDictationMode="story"
                onChange={(v) => {
                  onClearCdkSanitizedNotice?.();
                  onUpdateLine({ warrantyStory: v });
                }}
                className="benz-textarea text-[15px] leading-relaxed mb-4 min-h-[220px]"
                placeholder={t('storyPlaceholder')}
              />
            </div>
            {!isCustomerPayLine && Boolean(line.warrantyStory?.trim()) && (
              <StoryComplianceIndicator state={storyComplianceState} />
            )}
            {!isCustomerPayLine && (
              <div className="benz-quality-inset">
                {isGenerating && (
                  <StoryQualityLoadingPanel
                    mode="generating"
                    statusMessage={generationPhase.message}
                    progress={generationPhase.progress}
                  />
                )}
                {!isGenerating && isScoring && <StoryQualityLoadingPanel mode="scoring" />}
                {!isGenerating && !isScoring && isReviewing && <StoryQualityLoadingPanel mode="reviewing" />}
                {!isGenerating && !isScoring && !isReviewing && storyQuality && (
                  <StoryQualityPanel
                    quality={storyQuality}
                    review={storyReview}
                    panelKey={`${line.id}:${storyQuality.scoredAgainstStory ?? ''}:${storyQuality.score}`}
                    onApplyTechnicianDetail={(detail) => handleApplyTechnicianDetail(detail)}
                    onApplyAllTechnicianDetails={handleApplyAllTechnicianDetails}
                  />
                )}
                {!isGenerating && !isScoring && !isReviewing && !storyQuality && storyQualityStale && (
                  <StoryQualityStaleBanner onAudit={handleScoreStory} />
                )}
              </div>
            )}

            {showCertificationSection && (
              <TechnicianCertificationSection
                lineId={line.id}
                checked={certificationChecked}
                certifiedName={certificationName}
                onCheckedChange={setCertificationChecked}
                onNameChange={setCertificationName}
                isComplete={isCertificationComplete}
                isSaved={isStoryCertified}
                pendingReaudit={certificationPendingReaudit}
              />
            )}

            <div className="mt-4 pt-4 benz-divider space-y-3">
              <div className={`grid gap-2.5 ${showCertificationSection ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={certificationActionsLocked}
                  title={
                    certificationActionsLocked
                      ? storyComplianceState === 'not-audited'
                        ? t('runAuditFirst')
                        : storyComplianceState === 'audit-stale'
                          ? t('rerunAuditChanged')
                          : t('certifyToUnlockCopy')
                      : undefined
                  }
                  className="primary-btn w-full h-13 flex items-center justify-center gap-2.5 text-sm touch-target disabled:opacity-50"
                >
                  <Copy size={18} />
                  {t('copyForCdk')}
                </button>
                {showCertificationSection && (
                  <button
                    type="button"
                    onClick={handleCertifyAndSave}
                    disabled={
                      !isCertificationComplete ||
                      isCertifyingStory ||
                      isStoryCertified ||
                      certificationPendingReaudit
                    }
                    className="secondary-btn benz-btn-accent-outline h-13 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isCertifyingStory ? (
                      <>
                        <Loader2 size={18} className="animate-spin" /> {tCommon('saving')}
                      </>
                    ) : (
                      <>
                        <Save size={18} /> {tCommon('save')}
                      </>
                    )}
                  </button>
                )}
              </div>

              {!isCustomerPayLine && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={handleScoreStory}
                      disabled={isGenerating || isScoring || isReviewing || !(line.warrantyStory?.trim())}
                      className="secondary-btn benz-btn-accent-outline h-12 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                    >
                      {isScoring ? (
                        <>
                          <Loader2 size={16} className="animate-spin" /> {t('auditing')}
                        </>
                      ) : (
                        <>
                          <Shield size={16} /> {t('auditStory')}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateStory}
                      disabled={isGenerating || isScoring || isReviewing}
                      className="secondary-btn h-12 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                    >
                      {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                      {t('regenerate')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleReviewStory}
                    disabled={isGenerating || isScoring || isReviewing || !(line.warrantyStory?.trim())}
                    className="secondary-btn h-11 w-full flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {isReviewing ? (
                      <>
                        <Loader2 size={16} className="animate-spin" /> {t('reviewing')}
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} /> {t('reviewWithAi')}
                      </>
                    )}
                  </button>
                </>
              )}

              <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
                <button
                  type="button"
                  onClick={() => setShowTemplateLibrary(true)}
                  className="benz-tertiary-btn"
                >
                  <BookOpen size={14} /> {t('templates')}
                </button>
                {canSaveAsTemplate && (
                  <button
                    type="button"
                    onClick={() => setShowSaveTemplate(true)}
                    className="benz-tertiary-btn text-benz-green"
                  >
                    <BookmarkPlus size={14} /> {t('saveTemplate')}
                  </button>
                )}
                <button type="button" onClick={handlePdf} className="benz-tertiary-btn">
                  <Download size={14} /> {t('exportPdf')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <TemplateLibraryModal
        key={libraryRefreshKey}
        open={showTemplateLibrary}
        onClose={() => setShowTemplateLibrary(false)}
        onInsert={handleInsertTemplate}
        onApplyCustomerPay={onApplyCustomerPayTemplate}
        defaultTab={isCustomerPayLine ? 'customer' : 'warranty'}
      />

      {lastGeneratedStoryText && (
        <SaveTemplateModal
          open={showSaveTemplate}
          onClose={() => setShowSaveTemplate(false)}
          onSaved={(_title, savedText) => {
            onAcknowledgeStoryBaseline(savedText);
            setLibraryRefreshKey((k) => k + 1);
          }}
          defaultTitle={defaultTemplateTitle}
          defaultCategory="warranty"
          storyText={line.warrantyStory || ''}
          generatedText={lastGeneratedStoryText}
          lineDescription={line.description}
          vehicleMake={ro.vehicle.make}
          vehicleModel={ro.vehicle.model}
          codes={line.extractedData?.codes}
          repairOrderId={ro.id}
          lineId={line.id}
        />
      )}
    </div>
  );
}