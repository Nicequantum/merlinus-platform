'use client';

import { useEffect, useRef } from 'react';
import { subscribeCompanionVoice } from '@/lib/companionVoiceBridge';
import { useCompanionSync } from '@/hooks/useCompanionSync';
import type { useOcrProgress } from '@/hooks/useOcrProgress';
import type { useRepairOrders } from '@/hooks/useRepairOrders';
import { companionSnapshotHasChanges } from '@/lib/companionSnapshot';
import {
  companionRolePublishes,
  type CompanionSyncRole,
} from '@/lib/companionSyncRole';
import type { TechnicianSession } from '@/types';

type RepairOrdersApi = ReturnType<typeof useRepairOrders>;
type OcrApi = ReturnType<typeof useOcrProgress>;

interface CompanionSyncBridgeProps {
  session: TechnicianSession;
  enabled: boolean;
  role: CompanionSyncRole;
  ro: RepairOrdersApi;
  ocr: OcrApi;
  children: (companion: ReturnType<typeof useCompanionSync>) => React.ReactNode;
}

/** Wires SSE companion sync to repair-order state without changing tablet UI. */
export function CompanionSyncBridge({ enabled, role, ro, ocr, children }: CompanionSyncBridgeProps) {
  const roApiRef = useRef(ro);
  roApiRef.current = ro;
  const autoPublish = companionRolePublishes(role);

  const getRoApi = () => roApiRef.current;

  const ensureCompanionLineContext = async (repairOrderId: string, lineId?: string | null) => {
    await getRoApi().ensureRepairOrderOpen(repairOrderId);
    const api = getRoApi();
    if (lineId && (api.view !== 'line' || api.currentLineId !== lineId)) {
      await api.navigateToLine(lineId);
    }
  };

  const companion = useCompanionSync({
    enabled,
    role,
    onNavigation: async ({ view, repairOrderId, lineId }) => {
      const api = getRoApi();
      if (view === 'home') {
        api.setView('home');
        return;
      }
      if (!repairOrderId) return;
      await api.ensureRepairOrderOpen(repairOrderId);
      if (view === 'line' && lineId) {
        await getRoApi().navigateToLine(lineId);
      } else if (view === 'ro') {
        await getRoApi().navigateToRO();
      }
    },
    onRORefresh: async (repairOrderId) => {
      await getRoApi().ensureRepairOrderOpen(repairOrderId);
    },
    onROPatch: async (payload) => {
      await getRoApi().ensureRepairOrderOpen(payload.repairOrderId);
      getRoApi().mergeCompanionPatch(payload);
    },
    onStoryQuality: async ({ repairOrderId, lineId, quality }) => {
      await ensureCompanionLineContext(repairOrderId, lineId);
      getRoApi().applyCompanionStoryQuality(lineId, quality);
    },
    onStoryCertification: async ({
      repairOrderId,
      lineId,
      certifiedByName,
      certifiedAt,
      warrantyStory,
      storyHash,
    }) => {
      await ensureCompanionLineContext(repairOrderId, lineId);
      getRoApi().applyCompanionCertification(lineId, {
        certifiedByName,
        certifiedAt,
        warrantyStory,
        storyHash,
      });
    },
  });

  const { publishNavigation, publishStatus, recordActivity, isSubscriber, roSnapshotIntervalMs } =
    companion;

  useEffect(() => {
    if (!enabled || !autoPublish) return;
    publishNavigation({
      view: ro.view,
      repairOrderId: ro.currentRO?.id ?? null,
      lineId: ro.currentLineId,
    });
  }, [autoPublish, enabled, publishNavigation, ro.view, ro.currentRO?.id, ro.currentLineId]);

  useEffect(() => {
    if (!enabled || !autoPublish) return;
    return subscribeCompanionVoice((listening) => {
      const api = getRoApi();
      if (listening) {
        publishStatus('listening', {
          message: 'Listening to voice…',
          repairOrderId: api.currentRO?.id ?? null,
          lineId: api.currentLineId,
        });
      } else if (api.isGeneratingForLine || api.isScoringForLine) {
        return;
      } else {
        publishStatus('idle');
      }
    });
  }, [autoPublish, enabled, publishStatus]);

  useEffect(() => {
    if (!enabled || !autoPublish) return;
    const onLine = ro.view === 'line';
    const activePipeline = onLine ? ocr.xentry : ocr.roScan;
    if (activePipeline.isProcessing) {
      publishStatus(onLine ? 'processing_xentry' : 'scanning', {
        message: onLine
          ? 'Processing Xentry photos…'
          : activePipeline.statusMessage || 'Scanning repair order…',
        progress: activePipeline.progress,
        repairOrderId: ro.currentRO?.id ?? null,
        lineId: onLine ? ro.currentLineId : null,
      });
      return;
    }
    if (ro.isGeneratingForLine) {
      publishStatus('generating', {
        message: 'Generating warranty story…',
        repairOrderId: ro.currentRO?.id ?? null,
        lineId: ro.currentLineId,
      });
      return;
    }
    if (ro.isScoringForLine) {
      publishStatus('scoring', {
        message: 'Running MI Quality Audit…',
        repairOrderId: ro.currentRO?.id ?? null,
        lineId: ro.currentLineId,
      });
      return;
    }
    if (ro.isReviewingForLine) {
      publishStatus('reviewing', {
        message: 'AI review in progress…',
        repairOrderId: ro.currentRO?.id ?? null,
        lineId: ro.currentLineId,
      });
      return;
    }
    if (ro.isCertifyingStory) {
      publishStatus('certifying', {
        message: 'Certifying story…',
        repairOrderId: ro.currentRO?.id ?? null,
        lineId: ro.currentLineId,
      });
      return;
    }
    publishStatus('idle');
  }, [
    autoPublish,
    enabled,
    publishStatus,
    ocr.roScan,
    ocr.xentry,
    ro.currentLineId,
    ro.currentRO?.id,
    ro.isCertifyingStory,
    ro.isGeneratingForLine,
    ro.isReviewingForLine,
    ro.isScoringForLine,
    ro.view,
  ]);

  useEffect(() => {
    if (!enabled || !isSubscriber) return;

    const repairOrderId = ro.currentRO?.id;
    const onCompanionView = ro.view === 'ro' || ro.view === 'line';
    if (!repairOrderId || !onCompanionView) return;

    let cancelled = false;

    const syncSnapshot = async () => {
      if (cancelled) return;
      const api = getRoApi();
      if (!api.currentRO || api.currentRO.id !== repairOrderId) return;
      // Skip while story gen / audit / xentry / scan are busy (avoids clobber mid-workflow).
      if (
        api.isGeneratingForLine ||
        api.isScoringForLine ||
        api.isReviewingForLine ||
        api.isCertifyingStory
      ) {
        return;
      }

      const delta = await api.syncCompanionRepairOrderSnapshot(repairOrderId, {
        lineId: api.currentLineId,
      });
      if (!delta || !companionSnapshotHasChanges(delta)) return;

      for (const audit of delta.auditCompleted) {
        recordActivity(`Audit complete (score: ${audit.score})`, {
          repairOrderId,
          lineId: audit.lineId,
        });
      }
      for (const certified of delta.newlyCertified) {
        recordActivity('Story certified', {
          detail: certified.certifiedByName,
          repairOrderId,
          lineId: certified.lineId,
        });
      }
      for (const lineId of delta.storyUpdated) {
        recordActivity('Warranty story updated', { repairOrderId, lineId });
      }
      for (const lineId of delta.notesUpdated) {
        recordActivity('Line notes updated', { repairOrderId, lineId });
      }
      for (const photo of delta.photosUpdated) {
        recordActivity('Diagnostic photos updated', {
          repairOrderId,
          lineId: photo.lineId ?? null,
        });
      }
    };

    void syncSnapshot();
    const timer = setInterval(() => void syncSnapshot(), roSnapshotIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    enabled,
    isSubscriber,
    recordActivity,
    ro.currentLineId,
    ro.currentRO?.id,
    ro.view,
    roSnapshotIntervalMs,
  ]);

  return <>{children(companion)}</>;
}