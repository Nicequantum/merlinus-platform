'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { AppFooter } from '@/components/AppFooter';
import { AppHeader } from '@/components/AppHeader';
import { MaintenanceBanner } from '@/components/MaintenanceBanner';
import { HomeView } from '@/components/HomeView';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { LoadErrorScreen } from '@/components/LoadErrorScreen';
import { LoadingScreen } from '@/components/LoadingScreen';
import { RepairOrderHomeLists } from '@/components/RepairOrderHomeLists';
import { ROView } from '@/components/ROView';
import { SettingsView } from '@/components/SettingsView';
import { ViewErrorBoundary } from '@/components/ViewErrorBoundary';
import { CompanionSyncBridge } from '@/components/CompanionSyncBridge';
import { VoiceInputProvider } from '@/components/VoiceInputProvider';
import { useDesktopCompanion } from '@/hooks/useDesktopCompanion';
import { deriveCompanionSyncRole } from '@/lib/companionSyncRole';
import { useOcrProgress } from '@/hooks/useOcrProgress';
import { useRepairOrders } from '@/hooks/useRepairOrders';
import { clientLog } from '@/lib/clientLog';
import { recordTechnicianAppStart } from '@/lib/recordTechnicianAppStart';
import {
  effectiveIsAdmin,
  effectiveRole,
  effectiveServiceAdvisorId,
  isOwnerDealershipView,
} from '@/lib/apex/viewAs';
import { useTranslation } from 'react-i18next';
import { localeToSpeechLang } from '@/lib/i18n/locales';
import { setAppLanguage } from '@/i18n/config';
import type { TechnicianSession } from '@/types';

const ManagerDashboard = dynamic(
  () => import('@/components/ManagerDashboard').then((m) => m.ManagerDashboard),
  { loading: () => <LoadingScreen label="Loading manager dashboard" /> }
);

const AuditLogView = dynamic(
  () => import('@/components/AuditLogView').then((m) => m.AuditLogView),
  {
    loading: () => (
      <LoadingScreen label="Loading audit logs" sublabel="Fetching dealership activity…" />
    ),
  }
);

const ServiceAdvisorsView = dynamic(
  () => import('@/components/ServiceAdvisorsView').then((m) => m.ServiceAdvisorsView),
  { loading: () => <LoadingScreen label="Loading service advisors" /> }
);

const TechniciansView = dynamic(
  () => import('@/components/TechniciansView').then((m) => m.TechniciansView),
  { loading: () => <LoadingScreen label="Loading technicians" /> }
);

const LineView = dynamic(
  () => import('@/components/LineView').then((m) => m.LineView),
  { loading: () => <LoadingScreen label="Loading repair line" sublabel="Preparing warranty tools…" /> }
);

const AdvisorDashboard = dynamic(
  () => import('@/components/AdvisorDashboard').then((m) => m.AdvisorDashboard),
  { loading: () => <LoadingScreen label="Loading advisor dashboard" /> }
);

const DesktopCompanionLayout = dynamic(
  () => import('@/components/desktop/DesktopCompanionLayout').then((m) => m.DesktopCompanionLayout),
  { loading: () => <LoadingScreen label="Loading desktop companion" /> }
);

const VideoInspectionView = dynamic(
  () =>
    import('@/components/videoInspection/VideoInspectionView').then((m) => m.VideoInspectionView),
  { loading: () => <LoadingScreen label="Loading video inspection" /> }
);

const PartsDashboard = dynamic(
  () => import('@/components/parts/PartsDashboard').then((m) => m.PartsDashboard),
  { loading: () => <LoadingScreen label="Loading parts inbox" /> }
);

function runAction(label: string, action: () => void | Promise<void>): void {
  void Promise.resolve(action()).catch((error: unknown) => {
    clientLog.error('ui.action_failed', { label, error });
    toast.error(error instanceof Error ? error.message : `${label} failed`);
  });
}

interface BenzTechAuthenticatedAppProps {
  session: TechnicianSession;
  onLogout: () => Promise<void>;
  onSessionRefresh: () => Promise<TechnicianSession | null>;
}

/** Post-auth Merlinus shell — isolated from login so heavy RO/OCR modules never load on sign-in. */
export function BenzTechAuthenticatedApp({
  session,
  onLogout,
  onSessionRefresh,
}: BenzTechAuthenticatedAppProps) {
  const { t: tHome } = useTranslation('home');
  const ocr = useOcrProgress();
  const handleComplianceRequired = useCallback(() => {
    void onSessionRefresh();
  }, [onSessionRefresh]);
  const ro = useRepairOrders({
    session,
    roScanPipeline: ocr.roScan,
    xentryPipeline: ocr.xentry,
    getActivePipeline: ocr.getActivePipeline,
    onComplianceRequired: handleComplianceRequired,
  });

  // National Owner View As: branch UI on lens; identity stays role=owner.
  const roleForUi = effectiveRole(session);
  const isServiceAdvisor = roleForUi === 'service_advisor';
  const isManager = roleForUi === 'manager';
  const isParts = roleForUi === 'parts';
  const isDesktop = useDesktopCompanion();
  const companionSyncRole = deriveCompanionSyncRole(isDesktop);
  // Child UI that branches on role/isAdmin should see the View As lens.
  // Keep the real `session` for identity, companion sync, and API cookies.
  const uiSession: TechnicianSession = isOwnerDealershipView(session)
    ? {
        ...session,
        role: roleForUi,
        isAdmin: effectiveIsAdmin(session),
        serviceAdvisorId: effectiveServiceAdvisorId(session),
      }
    : session;

  const speechLanguage = localeToSpeechLang(session.preferredLanguage);

  useEffect(() => {
    setAppLanguage(session.preferredLanguage);
  }, [session.preferredLanguage]);

  // Cold-start: load Tesseract WASM after auth shell mounts so the first RO/Xentry
  // scan does not pay worker-init cost mid-pipeline (first-scan hang class).
  useEffect(() => {
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      void import('@/services/ocr')
        .then((m) => m.warmupOcrWorker())
        .then(() => {
          if (!cancelled) clientLog.info('ocr.shell_warmup_ready');
        })
        .catch((error: unknown) => {
          if (!cancelled) clientLog.warn('ocr.shell_warmup_failed', error);
        });
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(warm, { timeout: 2_500 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const timer = window.setTimeout(warm, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (isServiceAdvisor || ro.loading || ro.listError) return;
    void recordTechnicianAppStart({
      role: roleForUi,
      todayRoCount: ro.todayROs.length,
      previousRoCount: ro.previousROs.length,
    });
  }, [
    isServiceAdvisor,
    ro.loading,
    ro.listError,
    ro.todayROs.length,
    ro.previousROs.length,
    roleForUi,
  ]);

  if (!isServiceAdvisor && !isManager && !isParts && ro.loading && !ro.listError) {
    return <LoadingScreen label={tHome('loadingRos')} sublabel={tHome('loadingSublabel')} />;
  }

  if (!isServiceAdvisor && !isParts && ro.listError && !isManager) {
    return (
      <LoadErrorScreen
        title={tHome('loadErrorTitle')}
        message={ro.listError}
        onRetry={() => runAction('Retry loading repair orders', () => ro.retryListLoad())}
        retrying={ro.listRetrying}
      />
    );
  }

  const goToSettings = () => ro.setView('settings');

  // PR-M2 — Parts staff shell (no RO story pipeline)
  if (isParts) {
    return (
      <div className="app-container">
        <MaintenanceBanner />
        {ro.view === 'settings' ? (
          <SettingsView
            session={uiSession}
            onBack={() => ro.setView('home')}
            onLogout={onLogout}
            onSessionRefresh={onSessionRefresh}
          />
        ) : (
          <ViewErrorBoundary viewName="the parts inbox">
            <PartsDashboard
              session={uiSession}
              onOpenSettings={goToSettings}
              onLogout={onLogout}
            />
          </ViewErrorBoundary>
        )}
        <AppFooter />
      </div>
    );
  }

  if (isServiceAdvisor) {
    return (
      <div className="app-container">
        <MaintenanceBanner />
        {ro.view === 'settings' ? (
          <SettingsView
            session={uiSession}
            onBack={() => ro.setView('home')}
            onLogout={onLogout}
            onSessionRefresh={onSessionRefresh}
          />
        ) : ro.view === 'videoInspection' ? (
          <ViewErrorBoundary viewName="video inspection">
            <VideoInspectionView session={uiSession} onBack={() => ro.setView('home')} />
          </ViewErrorBoundary>
        ) : (
          <ViewErrorBoundary viewName="the service advisor dashboard">
            <AdvisorDashboard
              session={uiSession}
              onOpenSettings={goToSettings}
              onOpenVideoInspection={() => ro.setView('videoInspection')}
              onLogout={onLogout}
            />
          </ViewErrorBoundary>
        )}
        <AppFooter />
      </div>
    );
  }

  const roListSection = (
    <>
      {ro.loading && isManager && (
        <div className="benz-card p-4 mb-4 text-sm text-benz-secondary text-center">
          Loading today&apos;s repair orders…
        </div>
      )}
      {ro.listError && (
        <div className="benz-card border border-benz-amber/40 bg-benz-amber/5 p-4 mb-4 text-sm text-benz-secondary">
          <p className="font-medium text-benz-primary mb-2">Could not load repair orders</p>
          <p className="mb-3">{ro.listError}</p>
          <button
            type="button"
            onClick={() => runAction('Retry loading repair orders', () => ro.retryListLoad())}
            disabled={ro.listRetrying}
            className="secondary-btn h-10 px-4 touch-target disabled:opacity-60"
          >
            {ro.listRetrying ? 'Retrying…' : 'Try again'}
          </button>
        </div>
      )}
      <RepairOrderHomeLists
      searchTerm={ro.searchTerm}
      searchLoading={ro.searchLoading}
      searchResults={ro.searchROs}
      todayROs={ro.todayROs}
      previousROs={ro.previousROs}
      previousExpanded={ro.previousExpanded}
      onTogglePrevious={ro.togglePreviousExpanded}
      previousLoading={ro.previousLoading}
      previousLoadingMore={ro.previousLoadingMore}
      previousHasMore={ro.previousHasMore}
      onLoadMorePrevious={ro.loadMorePrevious}
      openingROId={ro.openingROId}
      onOpenRO={ro.openRO}
      onDeleteRO={ro.deleteRO}
    />
    </>
  );

  const openingRoNumber =
    ro.openingROId &&
    (ro.allROs.find((item) => item.id === ro.openingROId)?.roNumber || 'repair order');

  const wideLayout = ro.view === 'home' && isManager;
  const showDesktopCompanion =
    isDesktop && ro.currentRO && (ro.view === 'ro' || ro.view === 'line');
  const companionMode = showDesktopCompanion;

  return (
    <VoiceInputProvider speechLanguage={speechLanguage}>
    <CompanionSyncBridge session={session} enabled role={companionSyncRole} ro={ro} ocr={ocr}>
      {(companion) => (
    <div
      className={`app-container${wideLayout ? ' benz-app-wide' : ''}${companionMode ? ' benz-companion-mode' : ''}`}
    >
      <MaintenanceBanner />
      <LoadingOverlay
        visible={!!ro.openingROId}
        message={openingRoNumber ? `Loading ${openingRoNumber}…` : 'Loading repair order…'}
      />

      {ro.view !== 'home' &&
        ro.view !== 'settings' &&
        ro.view !== 'audit' &&
        ro.view !== 'advisors' &&
        ro.view !== 'technicians' &&
        ro.view !== 'videoInspection' &&
        ro.view !== 'parts' && (
          <AppHeader
            technicianName={session.name}
            dealershipName={session.dealershipName}
            onOpenSettings={goToSettings}
          />
        )}

      {ro.view === 'parts' && (
        <ViewErrorBoundary viewName="the parts inbox">
          <PartsDashboard
            session={uiSession}
            onOpenSettings={goToSettings}
            onLogout={onLogout}
          />
        </ViewErrorBoundary>
      )}

      {ro.view === 'home' && isManager && (
        <ViewErrorBoundary viewName="the manager dashboard">
          <ManagerDashboard
            session={uiSession}
            searchTerm={ro.searchTerm}
            onSearchChange={ro.setSearchTerm}
            openingROId={ro.openingROId}
            onOpenRO={ro.openRO}
            onOpenVideoInspection={() => ro.setView('videoInspection')}
            onOpenParts={() => ro.setView('parts')}
            onOpenSettings={goToSettings}
            onOpenAuditLogs={() => ro.setView('audit')}
            onOpenServiceAdvisors={() => ro.setView('advisors')}
            onOpenTechnicians={() => ro.setView('technicians')}
            pendingROImages={ro.pendingROImages}
            onScanRO={ro.scanRO}
            onAddFromGallery={ro.addScanPagesFromGallery}
            onProcessScan={ro.processPendingScan}
            onClearPendingScan={ro.clearPendingScan}
            onCancelScan={ro.cancelScan}
            onDeletePendingPage={ro.removePendingScanPage}
            onCreateManualRO={ro.createManualRO}
            isProcessingOCR={ocr.roScan.isProcessing}
            ocrProgress={ocr.roScan.progress}
            scanStatusMessage={ocr.roScan.statusMessage}
          >
            {roListSection}
          </ManagerDashboard>
        </ViewErrorBoundary>
      )}

      {ro.view === 'home' && !isManager && (
        <HomeView
          technicianName={session.name}
          dealershipName={session.dealershipName}
          searchTerm={ro.searchTerm}
          onSearchChange={ro.setSearchTerm}
          searchLoading={ro.searchLoading}
          searchROs={ro.searchROs}
          todayROs={ro.todayROs}
          previousROs={ro.previousROs}
          previousExpanded={ro.previousExpanded}
          onOpenVideoInspection={() => ro.setView('videoInspection')}
          onTogglePrevious={ro.togglePreviousExpanded}
          previousLoading={ro.previousLoading}
          previousLoadingMore={ro.previousLoadingMore}
          previousHasMore={ro.previousHasMore}
          onLoadMorePrevious={ro.loadMorePrevious}
          pendingROImages={ro.pendingROImages}
          isProcessingOCR={ocr.roScan.isProcessing}
          ocrProgress={ocr.roScan.progress}
          scanStatusMessage={ocr.roScan.statusMessage}
          onScanRO={ro.scanRO}
          onAddFromGallery={ro.addScanPagesFromGallery}
          onProcessScan={ro.processPendingScan}
          onClearPendingScan={ro.clearPendingScan}
          onCancelScan={ro.cancelScan}
          onDeletePendingPage={ro.removePendingScanPage}
          onCreateManualRO={ro.createManualRO}
          openingROId={ro.openingROId}
          onOpenRO={ro.openRO}
          onDeleteRO={ro.deleteRO}
          onOpenSettings={goToSettings}
        />
      )}

      {showDesktopCompanion && ro.currentRO && (
        <div className="benz-desktop-only">
          <ViewErrorBoundary viewName="the desktop companion">
            <DesktopCompanionLayout
              key={`companion-${ro.currentRO.id}-${ro.companionRevision}`}
              view={ro.view}
              ro={ro.currentRO}
              line={
                ro.view === 'line' || ro.currentLineId ? (ro.currentLine ?? null) : null
              }
              activeLineId={ro.currentLineId}
              technicianName={session.name}
              storyQuality={ro.storyQualityForLine}
              storyReview={ro.storyReviewForLine}
              storyQualityStale={ro.storyQualityStaleForLine}
              storyCertification={ro.storyCertificationForLine}
              lastGeneratedStoryText={ro.lastGeneratedStoryForLine}
              connectionState={companion.connectionState}
              workflowStatus={companion.workflowStatus}
              statusMessage={companion.statusMessage}
              statusProgress={companion.statusProgress}
              activities={companion.activities}
              onOpenLine={ro.navigateToLine}
              onBackToRepairLines={() => ro.navigateToRO()}
              onBackToHome={() => ro.setView('home')}
            />
          </ViewErrorBoundary>
        </div>
      )}

      {ro.view === 'ro' && ro.currentRO && (() => {
        const roXentry = ro.buildXentrySection({ scope: 'ro', roId: ro.currentRO.id });
        return (
        <ViewErrorBoundary viewName="the repair order">
          <div className={showDesktopCompanion ? 'benz-tablet-only' : undefined}>
          <ROView
            ro={ro.currentRO}
            isProcessingOCR={ocr.xentry.isProcessing}
            ocrProgress={ocr.xentry.progress}
            xentryStatusMessage={ocr.xentry.statusMessage}
            xentrySavedImages={roXentry.savedImages}
            xentryPendingImages={roXentry.pendingImages}
            xentryImagesNeedingAnalysisCount={roXentry.imagesNeedingAnalysisCount}
            xentryExtractedData={roXentry.extractedData}
            onDone={() => ro.setView('home')}
            onUpdateRONumber={ro.updateRONumber}
            onUpdateVehicle={(field, value) => ro.updateVehicle({ [field]: value })}
            onUpdateCustomer={ro.updateCustomer}
            onAddComplaint={ro.addComplaint}
            onEditComplaint={ro.editComplaint}
            onRemoveComplaint={ro.removeComplaint}
            onDecodeVin={ro.decodeVinForRO}
            onCaptureRoXentryPhoto={roXentry.onCapturePhoto}
            onAddRoXentryFromGallery={roXentry.onAddFromGallery}
            onProcessRoXentryImages={roXentry.onProcessImages}
            onClearPendingRoXentry={roXentry.onClearPending}
            onCancelRoXentryProcessing={roXentry.onCancelProcessing}
            onDeletePendingRoXentryImage={roXentry.onDeletePendingImage}
            onDeleteROXentryImage={(imageId) =>
              runAction('Delete Xentry photo', () => ro.deleteROXentryImage(imageId))
            }
            onAddRepairLine={ro.addRepairLine}
            onOpenLine={ro.navigateToLine}
            onDeleteRO={() =>
              runAction('Delete repair order', () => ro.deleteRO(ro.currentRO!.id))
            }
          />
          </div>
        </ViewErrorBoundary>
        );
      })()}

      {ro.view === 'line' && ro.currentRO && ro.currentLine && (() => {
        const lineXentry = ro.buildXentrySection({
          scope: 'line',
          lineId: ro.currentLine!.id,
        });
        return (
        <ViewErrorBoundary viewName="the repair line">
          <div className={showDesktopCompanion ? 'benz-tablet-only' : undefined}>
          <LineView
            ro={ro.currentRO}
            line={ro.currentLine}
            technicianName={session.name}
            isProcessingOCR={ocr.xentry.isProcessing}
            ocrProgress={ocr.xentry.progress}
            xentrySavedImages={lineXentry.savedImages}
            xentryPendingImages={lineXentry.pendingImages}
            xentryImagesNeedingAnalysisCount={lineXentry.imagesNeedingAnalysisCount}
            xentryStatusMessage={ocr.xentry.statusMessage}
            isGenerating={ro.isGeneratingForLine}
            isScoring={ro.isScoringForLine}
            isReviewing={ro.isReviewingForLine}
            storyQuality={ro.storyQualityForLine}
            storyReview={ro.storyReviewForLine}
            storyQualityStale={ro.storyQualityStaleForLine}
            storyCertification={ro.storyCertificationForLine}
            isCertifyingStory={ro.isCertifyingStory}
            lastGeneratedStoryText={ro.lastGeneratedStoryForLine}
            cdkSanitizedNotice={ro.cdkSanitizedForLine}
            onClearCdkSanitizedNotice={() => ro.clearCdkSanitizedNotice(ro.currentLine!.id)}
            onBack={() => ro.navigateToRO()}
            onUpdateLine={(updates, options) => {
              const lineId = ro.currentLine!.id;
              const roId = ro.currentRO!.id;
              ro.updateLine(lineId, updates, options);
              if (
                updates.warrantyStory !== undefined ||
                updates.technicianNotes !== undefined ||
                updates.customerConcern !== undefined
              ) {
                companion.publishROPatch({
                  repairOrderId: roId,
                  lineId,
                  linePatch: updates,
                });
                companion.publishActivity('Updated line fields', {
                  repairOrderId: roId,
                  lineId,
                });
              }
            }}
            onCaptureXentryPhoto={lineXentry.onCapturePhoto}
            onAddXentryFromGallery={lineXentry.onAddFromGallery}
            onProcessXentryImages={lineXentry.onProcessImages}
            onClearPendingXentry={lineXentry.onClearPending}
            onCancelXentryProcessing={lineXentry.onCancelProcessing}
            onDeletePendingXentryImage={lineXentry.onDeletePendingImage}
            onDeleteXentryImage={(imageId) =>
              runAction('Delete diagnostic photo', () =>
                ro.deleteLineXentryImage(ro.currentLine!.id, imageId)
              )
            }
            onGenerateStory={() => {
              const lineId = ro.currentLineId;
              if (!lineId || typeof ro.generateStory !== 'function') {
                clientLog.error('story.generate_unavailable', {
                  lineId,
                  hasGenerateStory: typeof ro.generateStory === 'function',
                });
                toast.error('Story generation is unavailable — refresh and try again');
                return;
              }
              companion.publishActivity('Generating warranty story', {
                repairOrderId: ro.currentRO!.id,
                lineId,
              });
              runAction('Generate warranty story', () => ro.generateStory(lineId));
            }}
            onScoreStory={(storyText) => {
              companion.publishActivity('Running MI Quality Audit…', {
                repairOrderId: ro.currentRO!.id,
                lineId: ro.currentLine!.id,
              });
              runAction('Audit warranty story', () => ro.scoreStory(ro.currentLine!.id, storyText));
            }}
            onReviewStory={(storyText) => {
              companion.publishActivity('Running AI review', {
                repairOrderId: ro.currentRO!.id,
                lineId: ro.currentLine!.id,
              });
              runAction('Review warranty story', () => ro.reviewStory(ro.currentLine!.id, storyText));
            }}
            onApplyCustomerPayTemplate={(templateId) => {
              companion.publishActivity('Applied Customer Pay template', {
                repairOrderId: ro.currentRO!.id,
                lineId: ro.currentLine!.id,
              });
              runAction('Apply Customer Pay template', () =>
                ro.applyCustomerPayTemplate(ro.currentLine!.id, templateId)
              );
            }}
            onClearCustomerPayMode={() =>
              runAction('Clear Customer Pay mode', () => ro.clearCustomerPayMode(ro.currentLine!.id))
            }
            onAcknowledgeStoryBaseline={(text) => ro.acknowledgeStoryBaseline(ro.currentLine!.id, text)}
            onCertifyAndSaveStory={(storyText, certifiedByName) => {
              companion.publishActivity('Certifying story', {
                repairOrderId: ro.currentRO!.id,
                lineId: ro.currentLine!.id,
              });
              runAction('Certify and save story', () =>
                ro.certifyAndSaveStory(ro.currentLine!.id, storyText, certifiedByName)
              );
            }}
          />
          </div>
        </ViewErrorBoundary>
        );
      })()}

      {ro.view === 'settings' && (
        <SettingsView
          session={uiSession}
          onBack={() => ro.setView(ro.currentRO ? 'ro' : 'home')}
          onLogout={onLogout}
          onSessionRefresh={onSessionRefresh}
          onOpenAuditLogs={isManager ? () => ro.setView('audit') : undefined}
          onOpenServiceAdvisors={isManager ? () => ro.setView('advisors') : undefined}
          onOpenTechnicians={isManager ? () => ro.setView('technicians') : undefined}
        />
      )}

      {ro.view === 'audit' && (
        <ViewErrorBoundary viewName="audit logs">
          <AuditLogView session={uiSession} onBack={() => ro.setView(isManager ? 'home' : 'settings')} />
        </ViewErrorBoundary>
      )}

      {ro.view === 'advisors' && isManager && (
        <ViewErrorBoundary viewName="service advisors">
          <ServiceAdvisorsView onBack={() => ro.setView('home')} />
        </ViewErrorBoundary>
      )}

      {ro.view === 'technicians' && isManager && (
        <ViewErrorBoundary viewName="technicians">
          <TechniciansView onBack={() => ro.setView('home')} />
        </ViewErrorBoundary>
      )}

      {ro.view === 'videoInspection' && (
        <ViewErrorBoundary viewName="video inspection">
          <VideoInspectionView session={uiSession} onBack={() => ro.setView('home')} />
        </ViewErrorBoundary>
      )}

      <AppFooter />
    </div>
      )}
    </CompanionSyncBridge>
    </VoiceInputProvider>
  );
}