'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  Plus,
  Shield,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MI_PRODUCT_LABEL } from '@/lib/grokModels';
import type { StoryQualityResult, StoryReviewResult, TechnicianDetailPrompt } from '@/types';

interface StoryQualityPanelProps {
  quality: StoryQualityResult;
  review?: StoryReviewResult | null;
  panelKey: string;
  /** Apply one coaching detail into the mapped line field (notes / concern). */
  onApplyTechnicianDetail?: (detail: TechnicianDetailPrompt, index: number) => void;
  /** Apply every coaching detail in one click. */
  onApplyAllTechnicianDetails?: (details: TechnicianDetailPrompt[]) => void;
}

interface StoryQualityLoadingProps {
  mode: 'generating' | 'scoring' | 'reviewing';
  statusMessage?: string;
  progress?: number;
}

interface StoryQualityStaleProps {
  onAudit?: () => void;
}

function scoreTier(score: number): 'excellent' | 'strong' | 'needs-work' | 'at-risk' {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'needs-work';
  return 'at-risk';
}

function scoreRingClass(score: number): string {
  const tier = scoreTier(score);
  return `benz-score-${tier}`;
}

function detailActionLabel(
  field: TechnicianDetailPrompt['field'],
  t: (key: string) => string
): string {
  switch (field) {
    case 'technicianNotes':
      return t('addToStoryNotes');
    case 'customerConcern':
      return t('addToStoryConcern');
    case 'diagnostic':
      return t('addDiagnosticToStory');
    case 'workflow':
      return t('addWorkflowToStory');
    default:
      return t('addToStory');
  }
}

export function StoryQualityLoadingPanel({ mode, statusMessage, progress = 0 }: StoryQualityLoadingProps) {
  const { t } = useTranslation('story');
  const title =
    mode === 'generating'
      ? t('loadingGenerating')
      : mode === 'scoring'
        ? t('loadingScoring')
        : t('loadingReviewing');
  const label =
    statusMessage ??
    (mode === 'generating'
      ? t('loadingWriting')
      : mode === 'scoring'
        ? t('loadingScoringBody')
        : t('loadingReviewBody'));

  return (
    <div className="benz-card p-4">
      <div className="flex items-center gap-3.5">
        <Loader2 size={22} className="animate-spin text-benz-blue shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="benz-section-title">{title}</div>
          <p className="text-sm text-benz-silver mt-1">{label}</p>
        </div>
      </div>
      {mode === 'generating' && progress > 0 && (
        <div className="benz-gen-progress mt-3" aria-hidden>
          <div className="benz-gen-progress-bar" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

export function StoryQualityStaleBanner({ onAudit }: StoryQualityStaleProps) {
  const { t } = useTranslation('story');
  return (
    <div className="benz-card p-4 benz-alert-warn flex items-start gap-3">
      <AlertTriangle size={20} className="text-benz-amber shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-widest font-semibold text-benz-amber">{t('scoreOutdated')}</div>
        <p className="text-sm text-benz-silver mt-1 leading-snug">{t('scoreOutdatedBody')}</p>
        {onAudit && (
          <button type="button" onClick={onAudit} className="mt-2.5 text-xs benz-link font-medium">
            {t('auditStoryArrow')}
          </button>
        )}
      </div>
    </div>
  );
}

export function StoryQualityPanel({
  quality,
  review,
  panelKey,
  onApplyTechnicianDetail,
  onApplyAllTechnicianDetails,
}: StoryQualityPanelProps) {
  const { t } = useTranslation('story');
  const [expanded, setExpanded] = useState(true);
  const [showReviewDetail, setShowReviewDetail] = useState(!!review);
  const [appliedIndexes, setAppliedIndexes] = useState<Set<number>>(() => new Set());

  const gradeLabels: Record<StoryQualityResult['grade'], string> = {
    excellent: t('gradeExcellent'),
    strong: t('gradeStrong'),
    'needs-work': t('gradeNeedsWork'),
    'at-risk': t('gradeAtRisk'),
  };

  useEffect(() => {
    setExpanded(true);
    setShowReviewDetail(!!review);
    setAppliedIndexes(new Set());
  }, [panelKey, review]);

  const ringClass = scoreRingClass(quality.score);
  const details = quality.technicianDetails;
  const canApply = Boolean(onApplyTechnicianDetail || onApplyAllTechnicianDetails);
  const allApplied = useMemo(
    () => details.length > 0 && details.every((_, i) => appliedIndexes.has(i)),
    [details, appliedIndexes]
  );

  const handleApplyOne = (detail: TechnicianDetailPrompt, index: number) => {
    if (!onApplyTechnicianDetail) return;
    onApplyTechnicianDetail(detail, index);
    setAppliedIndexes((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  const handleApplyAll = () => {
    if (!onApplyAllTechnicianDetails || details.length === 0) return;
    onApplyAllTechnicianDetails(details);
    setAppliedIndexes(new Set(details.map((_, i) => i)));
  };

  return (
    <div className="benz-card p-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3.5 text-left"
      >
        <div
          className={`shrink-0 w-14 h-14 rounded-2xl border flex flex-col items-center justify-center ${ringClass}`}
        >
          <span className="text-xl font-bold leading-none">{quality.score}</span>
          <span className="text-xs text-benz-secondary mt-0.5">/ 100</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Shield size={14} className="text-benz-blue" />
            <span className="benz-section-title">{t('qualityScoreTitle')}</span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${ringClass}`}>
              {gradeLabels[quality.grade]}
            </span>
          </div>
          <p className="text-sm text-benz-silver mt-1.5 leading-snug">{quality.summary}</p>
        </div>
        {expanded ? (
          <ChevronUp size={18} className="text-benz-secondary shrink-0 mt-1" />
        ) : (
          <ChevronDown size={18} className="text-benz-secondary shrink-0 mt-1" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 benz-divider pt-4">
          {quality.strengths.length === 0 &&
            quality.improvements.length === 0 &&
            quality.auditRisks.length === 0 &&
            details.length === 0 && (
              <p className="text-sm text-benz-secondary leading-snug">{t('feedbackMissing')}</p>
            )}

          {details.length > 0 && (
            <div className="benz-alert-info rounded-xl p-3.5 border">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-benz-blue flex items-center gap-1.5">
                  <Wrench size={12} /> {t('addTechDetails')}
                </div>
                {canApply && onApplyAllTechnicianDetails && (
                  <button
                    type="button"
                    onClick={handleApplyAll}
                    disabled={allApplied}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-benz-blue/40 bg-benz-blue/10 px-2.5 py-1.5 text-xs font-semibold text-benz-blue disabled:opacity-50 touch-target"
                  >
                    {allApplied ? (
                      <>
                        <CheckCircle2 size={12} /> {t('allAdded')}
                      </>
                    ) : (
                      <>
                        <Plus size={12} /> {t('addAllTechDetails')}
                      </>
                    )}
                  </button>
                )}
              </div>
              <p className="text-xs text-benz-secondary mb-3 leading-snug">
                {t('techDetailsHint', { mi: MI_PRODUCT_LABEL })}
              </p>
              <ul className="space-y-3">
                {details.map((detail, index) => {
                  const applied = appliedIndexes.has(index);
                  return (
                    <li key={`${detail.missing}-${index}`} className="text-xs leading-relaxed">
                      <div className="flex items-start gap-2">
                        <ClipboardList size={14} className="text-benz-blue shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-benz-amber">{detail.missing}</div>
                          <div className="text-benz-silver mt-0.5">{detail.prompt}</div>
                          {canApply && onApplyTechnicianDetail ? (
                            <button
                              type="button"
                              onClick={() => handleApplyOne(detail, index)}
                              disabled={applied}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-benz-blue/30 bg-benz-surface px-2.5 py-1.5 text-xs font-medium text-benz-blue disabled:opacity-60 touch-target"
                            >
                              {applied ? (
                                <>
                                  <CheckCircle2 size={12} className="text-benz-green" /> {t('added')}
                                </>
                              ) : (
                                <>
                                  <Plus size={12} /> {detailActionLabel(detail.field, t)}
                                </>
                              )}
                            </button>
                          ) : (
                            <div className="text-xs text-benz-muted mt-1">
                              {detailActionLabel(detail.field, t)}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {quality.strengths.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-green mb-2 flex items-center gap-1.5">
                <CheckCircle2 size={12} /> {t('strengths')}
              </div>
              <ul className="space-y-1.5">
                {quality.strengths.map((item) => (
                  <li key={item} className="text-xs text-benz-silver leading-relaxed pl-3 border-l-2 border-benz-green/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.improvements.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-amber mb-2 flex items-center gap-1.5">
                <Target size={12} /> {t('improveForMi')}
              </div>
              <ul className="space-y-1.5">
                {quality.improvements.map((item) => (
                  <li key={item} className="text-xs text-benz-silver leading-relaxed pl-3 border-l-2 border-benz-amber/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {quality.auditRisks.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-benz-red mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {t('auditRisks')}
              </div>
              <ul className="space-y-1.5">
                {quality.auditRisks.map((item) => (
                  <li key={item} className="text-xs text-benz-red/90 leading-relaxed pl-3 border-l-2 border-benz-red/40">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review && (
            <div>
              <button
                type="button"
                onClick={() => setShowReviewDetail((v) => !v)}
                className="text-xs uppercase tracking-wider font-semibold text-benz-blue flex items-center gap-1.5 mb-2"
              >
                <Sparkles size={12} />
                {t('aiReviewCoaching')} {showReviewDetail ? '▾' : '▸'}
              </button>
              {showReviewDetail && (
                <div className="space-y-3 benz-list-row p-3.5">
                  {review.priorityActions.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-benz-blue mb-1.5">{t('priorityActions')}</div>
                      <ol className="list-decimal list-inside space-y-1">
                        {review.priorityActions.map((action) => (
                          <li key={action} className="text-xs text-benz-silver leading-relaxed">
                            {action}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <ReviewSection title={t('structure3c')} text={review.feedback.structure} />
                  <ReviewSection title={t('technicalDetail')} text={review.feedback.technicalDetail} />
                  <ReviewSection title={t('clarity')} text={review.feedback.clarity} />
                  <ReviewSection title={t('workflow')} text={review.feedback.workflow} />
                  <ReviewSection title={t('fabricationRisk')} text={review.feedback.fabricationRisk} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewSection({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="text-xs font-semibold text-benz-secondary mb-0.5">{title}</div>
      <p className="text-xs text-benz-silver leading-relaxed">{text}</p>
    </div>
  );
}
