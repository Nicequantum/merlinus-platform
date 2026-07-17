'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { clientLog } from '@/lib/clientLog';
import {
  clearRoScanDraft,
  loadRoScanDraft,
  saveRoScanDraft,
  type RoScanDraftEntry,
} from '@/lib/roScanDraftStorage';
import { formatScanApiError, isStrongGrokExtraction } from '@/lib/scanPipeline';
import { runFastRoScanOcr, warmupOcrWorker } from '@/services/ocr';
import type { ImageAttachment, PendingImage, RepairOrder } from '@/types';
import {
  extractCustomerName,
  extractRoNumberFromText,
  finalizeLabeledComplaints,
  mergeMultiPassOcrExtractions,
  mergeROExtractions,
  mergeScanSources,
  parseStructuredROText,
  sanitizeComplaints,
  sanitizeVehicle,
} from '@/utils/roExtractor';
import type { StructuredROExtraction } from '@/types';
import { normalizeScanFiles } from '@/utils/scanFileHelpers';
import {
  classifyScanPages,
  combineRepairOrderPages,
  combineVmiPages,
} from '@/utils/scanDocumentClassifier';
import { extractVmiWarrantyInfo, mergeVehicleWarrantyInfo } from '@/utils/vmiExtractor';
import {
  resolvePendingImageFile,
  uploadFileAsAttachment,
  uploadRoScanAttachments,
} from '@/utils/uploadHelpers';
import { compressImageForRoScan } from '@/utils/imageCompression';
import { openImageFilePicker } from '@/utils/imageFilePicker';
import { ensureComplaintIds } from '@/utils/repairOrderFactory';
import {
  type VisionPipelineControls,
  type VisionPipelineId,
  visionPipelineBlockedMessage,
} from '@/hooks/visionPipeline';

interface UseROScanOptions {
  /** Flush + cancel stale debounced saves before scan (prevents post-scan overwrite). */
  prepareForScan: () => Promise<void>;
  /** Open scanned RO without flushPendingSave — navigateView races with new RO state. */
  openScanResultView: (repairOrder: RepairOrder) => void;
  scanInFlightRef: MutableRefObject<boolean>;
  roScanPipeline: VisionPipelineControls;
  getActivePipeline: () => VisionPipelineId | null;
}

/** RO document scan pipeline: pending pages, OCR, Grok extraction, and RO creation. */
export function useROScan({
  prepareForScan,
  openScanResultView,
  scanInFlightRef,
  roScanPipeline,
  getActivePipeline,
}: UseROScanOptions) {
  const [pendingROImages, setPendingROImages] = useState<PendingImage[]>([]);
  const scanCancelledRef = useRef(false);
  const scanSessionRef = useRef(0);
  const discardedPendingIdsRef = useRef<Set<string>>(new Set());
  const draftRestoredRef = useRef(false);

  const clearPendingPreviews = useCallback((images: PendingImage[]) => {
    images.forEach((img) => {
      if (img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
  }, []);

  const syncDraftFromImages = useCallback((images: PendingImage[]) => {
    const entries: RoScanDraftEntry[] = images
      .filter((img) => img.attachment && img.uploadStatus === 'saved')
      .map((img) => ({
        id: img.id,
        name: img.name,
        attachment: img.attachment!,
      }));
    saveRoScanDraft(entries);
  }, []);

  useEffect(() => {
    if (draftRestoredRef.current) return;
    draftRestoredRef.current = true;
    const draft = loadRoScanDraft();
    if (draft.length === 0) return;
    setPendingROImages(
      draft.map((entry) => ({
        id: entry.id,
        name: entry.name,
        previewUrl: entry.attachment.url,
        attachment: entry.attachment,
        uploadStatus: 'saved' as const,
      }))
    );
    toast.message(`Restored ${draft.length} saved scan page${draft.length === 1 ? '' : 's'} from last session`);
  }, []);

  const uploadAndSavePendingPage = useCallback(
    async (pendingId: string, file: File) => {
      try {
        const attachment = await uploadFileAsAttachment(file, 'roimg', compressImageForRoScan);
        if (discardedPendingIdsRef.current.has(pendingId)) {
          discardedPendingIdsRef.current.delete(pendingId);
          return;
        }

        setPendingROImages((prev) => {
          const next = prev.map((img) =>
            img.id === pendingId
              ? { ...img, attachment, uploadStatus: 'saved' as const, file: undefined }
              : img
          );
          syncDraftFromImages(next);
          return next;
        });
      } catch (error) {
        if (discardedPendingIdsRef.current.has(pendingId)) {
          discardedPendingIdsRef.current.delete(pendingId);
          return;
        }
        setPendingROImages((prev) =>
          prev.map((img) =>
            img.id === pendingId ? { ...img, uploadStatus: 'error' as const } : img
          )
        );
        clientLog.error('ro.scan.auto_save_failed', error);
        toast.error(
          error instanceof Error ? error.message : 'Page upload failed — delete and try again.'
        );
      }
    },
    [syncDraftFromImages]
  );

  const createROFromExtracted = useCallback(
    async (
      extracted: {
        vehicle: RepairOrder['vehicle'];
        complaints: string[];
        complaintLabels?: string[];
        customerName: string;
        roNumber?: string;
        serviceAdvisorName?: string;
      },
      options?: { idempotencyKey?: string; extractionSource?: 'grok' | 'ocr_fallback' }
    ): Promise<boolean> => {
      try {
        const finalized = finalizeLabeledComplaints(
          extracted.complaints || [],
          extracted.complaintLabels
        );
        const complaints = finalized.complaints;
        const complaintLabels = finalized.labels;
        const source = options?.extractionSource ?? 'grok';
        const { repairOrder } = await api.createRepairOrder(
          {
            fromExtraction: true,
            roNumber: extracted.roNumber || `R-${Date.now().toString().slice(-6)}`,
            vehicle: sanitizeVehicle(extracted.vehicle),
            customerName: extracted.customerName,
            serviceAdvisorName: extracted.serviceAdvisorName,
            advisorExtractionSource: source,
            complaints,
            complaintLabels,
          } as never,
          {
            idempotencyKey: (
              options?.idempotencyKey || `scan-${source}-${Date.now()}`
            ).slice(0, 128),
          }
        );
        const normalized = ensureComplaintIds(repairOrder);
        openScanResultView(normalized);
        scanInFlightRef.current = false;
        toast.success('Repair order created from scan');
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
        return false;
      }
    },
    [openScanResultView, scanInFlightRef]
  );

  const createROFromText = useCallback(
    async (text: string, options?: { idempotencyKey?: string }) => {
      const parsed = parseStructuredROText(text);
      const roNumber = parsed.roNumber || extractRoNumberFromText(text);
      const vehicle = sanitizeVehicle(parsed.vehicle);
      const complaints = sanitizeComplaints(parsed.complaints);
      const custName = parsed.customerName || extractCustomerName(text);
      try {
        const { repairOrder } = await api.createRepairOrder(
          {
            fromExtraction: true,
            roNumber,
            vehicle,
            customerName: custName,
            serviceAdvisorName: parsed.serviceAdvisorName,
            advisorExtractionSource: 'ocr_fallback',
            complaints,
            complaintLabels: parsed.complaintLabels,
          } as never,
          {
            idempotencyKey: (options?.idempotencyKey || `scan-ocr-${roNumber || 'x'}`).slice(
              0,
              128
            ),
          }
        );
        const normalized = ensureComplaintIds(repairOrder);
        openScanResultView(normalized);
        scanInFlightRef.current = false;
        toast.success('Repair order created from scan');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to create repair order');
      }
    },
    [openScanResultView, scanInFlightRef]
  );

  const mergePageOcrExtraction = useCallback(
    (
      accumulated: StructuredROExtraction | null,
      passExtractions: StructuredROExtraction[],
      passTexts: string[],
      pageMergedText: string
    ): StructuredROExtraction => {
      const pageMerged = mergeMultiPassOcrExtractions(passExtractions, passTexts);
      if (!accumulated) return pageMerged;
      return mergeROExtractions(accumulated, pageMerged, pageMergedText);
    },
    []
  );

  const processScanImages = useCallback(
    async (images: PendingImage[]) => {
      if (images.length === 0) return;
      if (scanInFlightRef.current) {
        toast.message('Scan already in progress…');
        return;
      }
      if (!roScanPipeline.tryAcquire()) {
        const blocker = getActivePipeline();
        if (blocker) toast.message(visionPipelineBlockedMessage(blocker));
        return;
      }

      const sessionId = ++scanSessionRef.current;
      const isActiveSession = () =>
        scanSessionRef.current === sessionId && !scanCancelledRef.current;

      scanCancelledRef.current = false;
      scanInFlightRef.current = true;

      let createdSuccessfully = false;

      try {
        await prepareForScan();
        if (!isActiveSession()) return;

        const stillUploading = images.some((img) => img.uploadStatus === 'uploading');
        if (stillUploading) {
          throw new Error('Wait for all pages to finish saving before processing.');
        }

        roScanPipeline.start('Preparing documents…');
        setPendingROImages(images);
        roScanPipeline.setProgress(8);
        const scanStartedAt = Date.now();
        // Warm Tesseract WASM while upload/Grok run — do not start recognize() yet.
        // Racing cold OCR with Grok caused first-scan hangs (soft timeout + hung terminate).
        void warmupOcrWorker().catch((error) => {
          clientLog.warn('OCR worker warmup failed', error);
        });

        const attachments: ImageAttachment[] = [];
        const needsUpload = images.filter((img) => !img.attachment?.pathname);
        if (needsUpload.length > 0) {
          roScanPipeline.setStatusMessage(
            `Uploading ${needsUpload.length} page${needsUpload.length === 1 ? '' : 's'}…`
          );
          clientLog.info('ro.scan.upload_start', { pageCount: needsUpload.length });
          const uploaded = await uploadRoScanAttachments(
            needsUpload.map((img) => img.file!).filter(Boolean)
          );
          clientLog.info('ro.scan.upload_done', {
            pageCount: uploaded.length,
            durationMs: Date.now() - scanStartedAt,
          });
          let uploadIndex = 0;
          for (const img of images) {
            if (img.attachment?.pathname) {
              attachments.push(img.attachment);
            } else {
              attachments.push(uploaded[uploadIndex]!);
              uploadIndex += 1;
            }
          }
        } else {
          roScanPipeline.setStatusMessage('Pages already saved — starting extraction…');
          for (const img of images) {
            attachments.push(img.attachment!);
          }
        }
        if (!isActiveSession()) return;

        const imagePathnames = attachments.map((a) => a.pathname);
        // Stable for this batch — double-tap / network replay will not create a second RO.
        const scanIdempotencyKey = `scan-${imagePathnames
          .map((p) => p.split('/').pop() || p)
          .join('_')}`.slice(0, 128);

        type ClientOcrResult = {
          combinedText: string;
          structuredFromPasses: StructuredROExtraction | null;
        };

        const emptyOcrResult = (): ClientOcrResult => ({
          combinedText: '',
          structuredFromPasses: null,
        });

        const runClientOcr = async (): Promise<ClientOcrResult> => {
          let combinedText = '';
          let structuredFromPasses: StructuredROExtraction | null = null;

          for (let i = 0; i < images.length; i++) {
            if (!isActiveSession()) return emptyOcrResult();
            const img = images[i];
            roScanPipeline.setStatusMessage(`Reading page ${i + 1} of ${images.length} (on-device OCR)…`);
            roScanPipeline.setProgress(Math.round(30 + (i / images.length) * 15));

            let ocrResult;
            try {
              const ocrFile = await resolvePendingImageFile(img);
              ocrResult = await runFastRoScanOcr(ocrFile, (p) => {
                if (!isActiveSession()) return;
                roScanPipeline.setProgress(Math.round(45 + (i / images.length) * 35 + (p / images.length) * 35));
              });
            } catch (error) {
              clientLog.warn(`On-device OCR failed on page ${i + 1}; continuing if AI vision succeeds`, error);
              continue;
            }

            const passExtractions = ocrResult.passes.map((pass) => parseStructuredROText(pass.text));
            const passTexts = ocrResult.passes.map((pass) => pass.text);
            structuredFromPasses = mergePageOcrExtraction(
              structuredFromPasses,
              passExtractions,
              passTexts,
              ocrResult.mergedText
            );
            combinedText += `\n\n=== PAGE ${i + 1} ===\n${ocrResult.mergedText}`;
          }

          return { combinedText, structuredFromPasses };
        };

        roScanPipeline.setProgress(35);
        roScanPipeline.setStatusMessage('AI vision extraction in progress…');
        clientLog.info('ro.scan.vision_start', {
          pageCount: imagePathnames.length,
          elapsedMs: Date.now() - scanStartedAt,
        });

        let extractError: string | null = null;
        // Grok-first: only run on-device OCR when vision is weak/failed.
        // Avoids cold WASM recognize racing the extract route on first scan after deploy.
        const grokExtracted = await api.extractRO(imagePathnames).catch((error) => {
          extractError = formatScanApiError(error);
          clientLog.error('ro.scan.extract_api_failed', {
            message: extractError,
            status: error instanceof ApiError ? error.status : undefined,
            pageCount: imagePathnames.length,
            pathnames: imagePathnames,
            elapsedMs: Date.now() - scanStartedAt,
          });
          return null;
        });
        if (!isActiveSession()) return;

        clientLog.info('ro.scan.vision_done', {
          strong: isStrongGrokExtraction(grokExtracted),
          elapsedMs: Date.now() - scanStartedAt,
          hasError: Boolean(extractError),
        });

        let ocrResult: ClientOcrResult;
        if (isStrongGrokExtraction(grokExtracted)) {
          roScanPipeline.setProgress(78);
          roScanPipeline.setStatusMessage('AI vision complete — finalizing repair order…');
          ocrResult = emptyOcrResult();
        } else {
          roScanPipeline.setStatusMessage('AI vision inconclusive — running on-device OCR fallback…');
          clientLog.info('ro.scan.ocr_fallback_start', { elapsedMs: Date.now() - scanStartedAt });
          ocrResult = await runClientOcr().catch((error) => {
            clientLog.error('ro.scan.ocr_failed', error);
            return emptyOcrResult();
          });
          clientLog.info('ro.scan.ocr_fallback_done', { elapsedMs: Date.now() - scanStartedAt });
        }
        if (!isActiveSession()) return;

        const ocrText = ocrResult.combinedText;
        const structuredFromPasses = ocrResult.structuredFromPasses;

        if (!ocrText?.trim() && !grokExtracted) {
          const detail =
            extractError ||
            'Could not read the repair order — no text from on-device OCR or AI vision.';
          throw new Error(detail);
        }

        if (!grokExtracted && extractError && ocrText?.trim()) {
          toast.warning(`On-device OCR used — AI vision unavailable: ${extractError}`);
        }

        roScanPipeline.setProgress(82);
        roScanPipeline.setStatusMessage('Cross-validating AI vision and OCR results…');

        const classifiedPages = classifyScanPages(ocrText || '');
        const roOcrText =
          combineRepairOrderPages(classifiedPages) ||
          (classifiedPages.some((page) => page.kind === 'repair_order') ? '' : ocrText || '');
        const vmiOcrText = combineVmiPages(classifiedPages);
        const vmiWarranty = extractVmiWarrantyInfo(vmiOcrText);

        const ocrExtracted =
          structuredFromPasses ||
          (roOcrText ? parseStructuredROText(roOcrText) : null);
        let extracted = mergeScanSources(grokExtracted, ocrExtracted, roOcrText || ocrText || '');

        if (vmiWarranty && Object.keys(vmiWarranty).length > 0) {
          extracted = {
            ...extracted,
            vehicle: {
              ...extracted.vehicle,
              warrantyInfo: mergeVehicleWarrantyInfo(extracted.vehicle.warrantyInfo, vmiWarranty),
            },
          };
        }

        if (!isActiveSession()) return;
        roScanPipeline.setProgress(88);
        roScanPipeline.setStatusMessage('Creating repair order…');
        createdSuccessfully = await createROFromExtracted(extracted, {
          idempotencyKey: scanIdempotencyKey,
          extractionSource: grokExtracted ? 'grok' : 'ocr_fallback',
        });
        if (!createdSuccessfully) {
          throw new Error('Failed to create repair order from scan.');
        }

        roScanPipeline.setProgress(100);
        roScanPipeline.setStatusMessage('Opening repair order…');
      } catch (error) {
        if (!isActiveSession()) return;
        const message = formatScanApiError(error);
        clientLog.error('ro.scan.failed', {
          message,
          status: error instanceof ApiError ? error.status : undefined,
          pageCount: images.length,
          rawError: error instanceof Error ? error.message : undefined,
        });
        toast.error(message);
        if (!createdSuccessfully) {
          setPendingROImages(images);
        } else {
          clearPendingPreviews(images);
          setPendingROImages([]);
        }
      } finally {
        if (scanSessionRef.current === sessionId) {
          if (createdSuccessfully) {
            clearPendingPreviews(images);
            setPendingROImages([]);
            clearRoScanDraft();
          } else {
            scanInFlightRef.current = false;
          }
          roScanPipeline.finish();
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scanInFlightRef is a stable ref
    [
      clearPendingPreviews,
      createROFromExtracted,
      getActivePipeline,
      mergePageOcrExtraction,
      prepareForScan,
      roScanPipeline,
    ]
  );

  const appendScanPages = useCallback(
    async (rawFiles: File[]) => {
      if (rawFiles.length === 0) return;

      try {
        const normalizedFiles = await normalizeScanFiles(rawFiles);
        if (normalizedFiles.length === 0) {
          toast.error('No supported images or PDFs were selected.');
          return;
        }

        let newImages: PendingImage[] = [];
        let total = 0;
        setPendingROImages((prev) => {
          const baseIndex = prev.length;
          newImages = normalizedFiles.map((file, i) => ({
            id: 'roimg-' + Date.now() + '-' + i,
            previewUrl: URL.createObjectURL(file),
            name: file.name || `page-${baseIndex + i + 1}.jpg`,
            file,
            uploadStatus: 'uploading' as const,
          }));
          total = baseIndex + newImages.length;
          return [...prev, ...newImages];
        });
        toast.success(
          `Saving ${newImages.length} page${newImages.length === 1 ? '' : 's'} (${total} total)…`
        );

        for (const img of newImages) {
          if (img.file) {
            void uploadAndSavePendingPage(img.id, img.file);
          }
        }
      } catch (error) {
        clientLog.error('Scan file preparation failed', error);
        toast.error(error instanceof Error ? error.message : 'Could not prepare files for scan.');
      }
    },
    [uploadAndSavePendingPage]
  );

  const removePendingScanPage = useCallback(
    (imageId: string) => {
      setPendingROImages((prev) => {
        const img = prev.find((p) => p.id === imageId);
        if (!img) return prev;
        if (img.uploadStatus === 'uploading') {
          discardedPendingIdsRef.current.add(imageId);
        }
        clearPendingPreviews([img]);
        const next = prev.filter((p) => p.id !== imageId);
        syncDraftFromImages(next);
        return next;
      });
      toast.message('Scan page removed');
    },
    [clearPendingPreviews, syncDraftFromImages]
  );

  const scanRO = useCallback(() => {
    openImageFilePicker({
      capture: true,
      multiple: false,
      onFiles: (files) => {
        void appendScanPages(files);
      },
    });
  }, [appendScanPages]);

  const addScanPagesFromGallery = useCallback(() => {
    openImageFilePicker({
      multiple: true,
      accept: 'image/*,application/pdf',
      onFiles: (files) => {
        void appendScanPages(files);
      },
    });
  }, [appendScanPages]);

  const processPendingScan = useCallback(async () => {
    if (scanInFlightRef.current) {
      toast.message('Scan already in progress…');
      return;
    }
    if (pendingROImages.length === 0) {
      toast.message('Add at least one page before processing.');
      return;
    }
    if (pendingROImages.some((img) => img.uploadStatus === 'uploading')) {
      toast.message('Wait for all pages to finish saving before processing.');
      return;
    }
    const snapshot = [...pendingROImages];
    await processScanImages(snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scanInFlightRef is a stable ref
  }, [pendingROImages, processScanImages]);

  const clearPendingScan = useCallback(() => {
    pendingROImages.forEach((img) => {
      if (img.uploadStatus === 'uploading') {
        discardedPendingIdsRef.current.add(img.id);
      }
    });
    clearPendingPreviews(pendingROImages);
    setPendingROImages([]);
    clearRoScanDraft();
    toast.message('Scan pages cleared');
  }, [clearPendingPreviews, pendingROImages]);

  const cancelScan = useCallback(() => {
    scanSessionRef.current += 1;
    scanCancelledRef.current = true;
    scanInFlightRef.current = false;
    pendingROImages.forEach((img) => {
      if (img.uploadStatus === 'uploading') {
        discardedPendingIdsRef.current.add(img.id);
      }
    });
    clearPendingPreviews(pendingROImages);
    setPendingROImages([]);
    clearRoScanDraft();
    roScanPipeline.finish();
    toast.message('Scan cancelled');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- scanInFlightRef is a stable ref
  }, [clearPendingPreviews, pendingROImages, roScanPipeline]);

  return {
    pendingROImages,
    setPendingROImages,
    scanRO,
    addScanPagesFromGallery,
    processPendingScan,
    clearPendingScan,
    cancelScan,
    removePendingScanPage,
    createROFromText,
  };
}