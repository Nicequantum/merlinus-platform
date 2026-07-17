'use client';

import { ChevronLeft, Copy, Home, MonitorSmartphone } from 'lucide-react';
import { XentryImageGallery } from '@/components/XentryImageGallery';
import { toast } from 'sonner';
import { CompanionActivitySidebar } from '@/components/desktop/CompanionActivitySidebar';
import { CompanionConnectionBadge } from '@/components/desktop/CompanionConnectionBadge';
import { CompanionStatusBar } from '@/components/desktop/CompanionStatusBar';
import { StoryComplianceIndicator } from '@/components/StoryComplianceIndicator';
import {
  StoryQualityPanel,
  StoryQualityStaleBanner,
} from '@/components/StoryQualityPanel';
import { SoldMetricsSummary } from '@/components/SoldMetricsSummary';
import { useLineViewCertificationForm } from '@/hooks/lineView/useLineViewCertificationForm';
import type { StoryCertificationRecord } from '@/hooks/repairOrders/useROStoryWorkflow';
import type {
  CompanionActivityEntry,
  CompanionConnectionState,
  CompanionWorkflowStatus,
} from '@/lib/companionSyncTypes';
import { deriveCompanionLineStoryState } from '@/lib/companionLineStoryState';
import { isCustomerPayRepairLine } from '@/lib/customerPayLine';
import { hasSoldMetrics } from '@/lib/repairLineSoldMetrics';
import { isStoryQualityCurrent } from '@/lib/storyQualityState';
import type { AppView, RepairLine, RepairOrder, StoryQualityResult, StoryReviewResult } from '@/types';
import { copyFormattedStory } from '@/utils/pdfExport';

interface DesktopCompanionLayoutProps {
  view: AppView;
  ro: RepairOrder;
  line: RepairLine | null;
  activeLineId: string | null;
  technicianName?: string;
  storyQuality: StoryQualityResult | null;
  storyReview: StoryReviewResult | null;
  storyQualityStale: boolean;
  storyCertification: StoryCertificationRecord | null;
  lastGeneratedStoryText?: string | null;
  connectionState: CompanionConnectionState;
  workflowStatus: CompanionWorkflowStatus;
  statusMessage?: string | null;
  statusProgress?: number | null;
  activities: CompanionActivityEntry[];
  onOpenLine: (lineId: string) => void;
  onBackToRepairLines: () => void;
  onBackToHome: () => void;
}

export function DesktopCompanionLayout({
  view,
  ro,
  line,
  activeLineId,
  technicianName,
  storyQuality,
  storyReview,
  storyQualityStale,
  storyCertification,
  lastGeneratedStoryText = null,
  connectionState,
  workflowStatus,
  statusMessage,
  statusProgress,
  activities,
  onOpenLine,
  onBackToRepairLines,
  onBackToHome,
}: DesktopCompanionLayoutProps) {
  const syncedLineStory = deriveCompanionLineStoryState({
    ro,
    activeLineId: activeLineId ?? line?.id ?? null,
    storyQuality,
    storyReview,
    storyQualityStale,
    storyCertification,
  });
  const activeLine = syncedLineStory.activeLine;
  const resolvedStoryQuality = syncedLineStory.storyQuality;
  const resolvedStoryReview = syncedLineStory.storyReview;
  const resolvedStoryQualityStale = syncedLineStory.storyQualityStale;
  const resolvedStoryCertification = syncedLineStory.storyCertification;

  const isCustomerPayLine = activeLine ? isCustomerPayRepairLine(activeLine) : false;
  const storyText = activeLine?.warrantyStory?.trim() ?? '';

  const { certificationActionsLocked, storyComplianceState } = useLineViewCertificationForm({
    lineId: activeLine?.id ?? 'desktop',
    isCustomerPayLine,
    technicianName,
    hasWarrantyStory: Boolean(storyText),
    storyQuality: resolvedStoryQuality,
    storyQualityStale: resolvedStoryQualityStale,
    storyCertification: resolvedStoryCertification,
    lastGeneratedStoryText,
  });

  const handleCopy = async () => {
    if (!activeLine || !storyText) {
      toast.error('No warranty story to copy yet');
      return;
    }
    if (certificationActionsLocked) {
      toast.error('Complete audit and certification on the tablet before copying');
      return;
    }
    try {
      const { wasModified } = await copyFormattedStory(ro, activeLine, storyText);
      if (wasModified) toast.message('Story cleaned for CDK compatibility');
      toast.success('Story copied — ready to paste into CDK');
    } catch {
      toast.error('Clipboard copy failed');
    }
  };

  const vehicleSummary = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ');
  const showRepairLineList = view === 'ro' && !activeLineId;
  const roDiagnosticPhotos = ro.xentryImages ?? [];
  const lineDiagnosticPhotos = activeLine?.xentryImages ?? [];

  return (
    <div className="benz-companion-layout">
      <header className="benz-companion-header">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <MonitorSmartphone size={18} className="text-benz-blue shrink-0" />
            <span className="text-xs uppercase tracking-widest font-semibold text-benz-secondary">
              Desktop Companion
            </span>
            <CompanionConnectionBadge state={connectionState} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-benz-primary truncate">
            {ro.roNumber}
            {activeLine ? ` · Line ${activeLine.lineNumber}` : ''}
          </h1>
          <p className="text-sm text-benz-secondary mt-1 truncate">
            {vehicleSummary}
            {ro.vehicle.mileageIn ? ` · ${ro.vehicle.mileageIn} mi` : ''}
            {activeLine?.description ? ` · ${activeLine.description}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!storyText || certificationActionsLocked}
          className="benz-companion-copy-btn primary-btn flex items-center justify-center gap-2.5 disabled:opacity-50"
          title={
            certificationActionsLocked
              ? 'Complete audit and certification on the tablet first'
              : 'Copy formatted story for CDK'
          }
        >
          <Copy size={20} />
          Copy for CDK
        </button>
      </header>

      <CompanionStatusBar status={workflowStatus} message={statusMessage} progress={statusProgress} />

      <nav className="benz-companion-nav" aria-label="Desktop companion navigation">
        <button type="button" onClick={onBackToHome} className="benz-companion-nav-btn">
          <Home size={16} />
          Home
        </button>
        {!showRepairLineList && (
          <button type="button" onClick={onBackToRepairLines} className="benz-companion-nav-btn">
            <ChevronLeft size={16} />
            Repair lines
          </button>
        )}
      </nav>

      <div className="benz-companion-body">
        <main className="benz-companion-main">
          {showRepairLineList && roDiagnosticPhotos.length > 0 && (
            <div className="benz-card p-5 mb-4">
              <div className="benz-section-title mb-2">RO Diagnostic Photos</div>
              <p className="text-sm text-benz-secondary mb-3">
                Photos captured on your tablet for this repair order.
              </p>
              <XentryImageGallery images={roDiagnosticPhotos} />
            </div>
          )}

          {showRepairLineList && (
            <div className="benz-card p-5 mb-4">
              <div className="benz-section-title mb-2">Repair Lines</div>
              <p className="text-sm text-benz-secondary mb-4">
                Click a repair line below to open its story, or select one on your tablet.
              </p>
              <ul className="space-y-2" role="list">
                {ro.repairLines.map((repairLine) => {
                  const audit = repairLine.storyQualityAudit;
                  const story = repairLine.warrantyStory?.trim();
                  const score =
                    audit && story && isStoryQualityCurrent(audit, story) ? audit.score : null;
                  return (
                    <li key={repairLine.id} role="listitem">
                      <button
                        type="button"
                        onClick={() => onOpenLine(repairLine.id)}
                        className="benz-companion-line-row benz-companion-line-row-btn w-full text-left"
                        aria-label={`Open line ${repairLine.lineNumber}: ${repairLine.description}`}
                      >
                        <span className="font-medium text-benz-primary">
                          Line {repairLine.lineNumber}: {repairLine.description}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 shrink-0">
                          {score != null && (
                            <span className="text-xs text-benz-blue font-semibold">MI {score}/100</span>
                          )}
                          {repairLine.storyCertification && (
                            <span className="text-xs text-benz-green font-semibold">Certified</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {activeLine && (
            <>
              {lineDiagnosticPhotos.length > 0 && (
                <div className="benz-card p-5 mb-4">
                  <div className="benz-section-title mb-2">Diagnostic Photos</div>
                  <p className="text-sm text-benz-secondary mb-3">
                    Xentry and diagnostic photos for this repair line.
                  </p>
                  <XentryImageGallery images={lineDiagnosticPhotos} />
                </div>
              )}

              <div className="benz-card p-5 mb-4">
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="benz-section-title">
                    {isCustomerPayLine ? 'Customer Pay Story' : 'Warranty Story'}
                  </div>
                  {isCustomerPayLine && (
                    <span className="benz-cp-badge text-xs">Customer Pay</span>
                  )}
                </div>
                {activeLine.customerConcern && (
                  <p className="text-sm text-benz-secondary mb-3 leading-relaxed">
                    <span className="font-medium text-benz-silver">Concern: </span>
                    {activeLine.customerConcern}
                  </p>
                )}
                {storyText ? (
                  <div className="benz-companion-story whitespace-pre-wrap text-[15px] leading-relaxed text-benz-primary">
                    {storyText}
                  </div>
                ) : (
                  <p className="text-sm text-benz-secondary italic">
                    No story yet — generate or dictate on your tablet.
                  </p>
                )}
              </div>

              {!isCustomerPayLine && storyText && (
                <StoryComplianceIndicator state={storyComplianceState} />
              )}

              {!isCustomerPayLine && resolvedStoryQuality && !resolvedStoryQualityStale && (
                <StoryQualityPanel
                  quality={resolvedStoryQuality}
                  review={resolvedStoryReview}
                  panelKey={`desktop:${activeLine.id}:${resolvedStoryQuality.score}`}
                />
              )}
              {!isCustomerPayLine && !resolvedStoryQuality && resolvedStoryQualityStale && (
                <StoryQualityStaleBanner />
              )}

              {hasSoldMetrics(activeLine.soldMetrics) && activeLine.soldMetrics && (
                <div className="mt-4">
                  <SoldMetricsSummary metrics={activeLine.soldMetrics} />
                </div>
              )}

              {resolvedStoryCertification && (
                <div className="benz-card p-4 mt-4 border border-benz-green/25 bg-benz-green/5">
                  <p className="text-sm text-benz-green">
                    Certified by {resolvedStoryCertification.certifiedByName}
                  </p>
                </div>
              )}
            </>
          )}
        </main>

        <CompanionActivitySidebar activities={activities} />
      </div>
    </div>
  );
}