'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ClipboardList,
  CloudOff,
  Link2,
  Loader2,
  Mic,
  RefreshCw,
  Square,
  Upload,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { localeToSpeechLang, normalizePreferredLanguage } from '@/lib/i18n/locales';
import { isOnline, VideoCaptureSession } from '@/lib/videoInspection/captureSession';
import {
  uploadVideoInspectionResumable,
  type UploadProgress,
} from '@/lib/videoInspection/chunkedUploadClient';
import { defaultChecklistTemplate } from '@/lib/videoInspection/findings';
import {
  MPI_CATEGORIES,
  MPI_CATEGORY_LABELS,
  MPI_SEVERITIES,
  MPI_SEVERITY_LABELS,
  MPI_STATUSES,
  mpiCategoryLabel,
  type MpiCategory,
  type MpiSeverity,
  type MpiStatus,
} from '@/lib/videoInspection/mpiCategories';
import {
  countPendingUploads,
  enqueuePendingUpload,
  listPendingUploads,
  removePendingUpload,
  updatePendingUpload,
  type PendingVideoUpload,
} from '@/lib/videoInspection/offlineQueue';
import type {
  TechnicianSession,
  VideoInspectionDetail,
  VideoInspectionSummary,
} from '@/types';

interface VideoInspectionViewProps {
  session: TechnicianSession;
  onBack: () => void;
}

type ChecklistDraftRow = {
  category: string;
  severity: MpiSeverity;
  note: string;
};

function statusPillClass(status: string): string {
  switch (status) {
    case 'ready':
    case 'sent':
      return 'status-pill-valid';
    case 'failed':
    case 'processing':
      return 'status-pill-warn';
    default:
      return 'status-pill-warn';
  }
}

function severityDotClass(severity: MpiSeverity): string {
  if (severity === 'urgent') return 'bg-red-500';
  if (severity === 'recommend') return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function VideoInspectionView({ session, onBack }: VideoInspectionViewProps) {
  const { t } = useTranslation('video');
  const [list, setList] = useState<VideoInspectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VideoInspectionDetail | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>('list');
  const [statusFilter, setStatusFilter] = useState<'all' | MpiStatus>('all');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [vin, setVin] = useState('');
  const [transcript, setTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [reportDraft, setReportDraft] = useState('');
  const [checklist, setChecklist] = useState<ChecklistDraftRow[]>(defaultChecklistTemplate());
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [pending, setPending] = useState<PendingVideoUpload[]>([]);
  const [flushingQueue, setFlushingQueue] = useState(false);
  const [online, setOnline] = useState(true);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureRef = useRef<VideoCaptureSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const flushingRef = useRef(false);

  const speechLang = localeToSpeechLang(session.preferredLanguage);

  const refreshList = useCallback(async () => {
    setLoading(true);
    try {
      const { inspections } = await api.listVideoInspections();
      setList(inspections);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load inspections');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await listPendingUploads());
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    void refreshList();
    void refreshPending();
  }, [refreshList, refreshPending]);

  useEffect(() => {
    const sync = () => setOnline(isOnline());
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  useEffect(() => {
    return () => {
      void captureRef.current?.cancel();
      captureRef.current = null;
    };
  }, []);

  const filteredList = useMemo(() => {
    if (statusFilter === 'all') return list;
    return list.filter((item) => item.status === statusFilter);
  }, [list, statusFilter]);

  const boardCounts = useMemo(() => {
    const counts: Record<string, number> = { all: list.length };
    for (const s of MPI_STATUSES) counts[s] = 0;
    for (const item of list) {
      counts[item.status] = (counts[item.status] || 0) + 1;
    }
    return counts;
  }, [list]);

  const buildMeta = useCallback(
    (recordingMode: 'fullscreen' | 'standard' | 'upload', durationSec?: number) => ({
      title: 'Video inspection',
      vehicleLabel: vehicleLabel.trim() || undefined,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      vin: vin.trim() || undefined,
      transcript: transcript.trim() || undefined,
      transcriptLanguage: normalizePreferredLanguage(session.preferredLanguage),
      recordingMode,
      durationSec,
    }),
    [vehicleLabel, customerName, customerPhone, vin, transcript, session.preferredLanguage]
  );

  const uploadBlob = useCallback(
    async (
      blob: Blob,
      options: {
        durationSec?: number;
        recordingMode: 'fullscreen' | 'standard' | 'upload';
        frames?: Blob[];
      }
    ) => {
      setBusy(true);
      setUploadProgress({
        phase: 'init',
        chunksTotal: 1,
        chunksSent: 0,
        percent: 1,
        message: t('uploadStarting'),
      });

      const meta = buildMeta(options.recordingMode, options.durationSec);
      const frames = options.frames || [];

      const runUpload = async () =>
        uploadVideoInspectionResumable({
          video: blob,
          frames,
          meta,
          onProgress: setUploadProgress,
        });

      try {
        if (!isOnline()) {
          await enqueuePendingUpload({
            contentType: blob.type || 'video/webm',
            video: blob,
            frames,
            meta,
            lastError: 'offline',
          });
          await refreshPending();
          toast.message(t('queuedOffline'));
          setMode('list');
          return;
        }

        const { inspection } = await runUpload();
        applyDetail(inspection);
        setMode('detail');
        toast.success(t('videoSaved'));
        void refreshList();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Upload failed';
        // Network / transient failures → offline queue
        const retriable =
          !isOnline() ||
          /network|fetch|failed to fetch|timeout|abort|offline|503|502|504/i.test(message);
        if (retriable) {
          try {
            await enqueuePendingUpload({
              contentType: blob.type || 'video/webm',
              video: blob,
              frames,
              meta,
              lastError: message,
            });
            await refreshPending();
            toast.message(t('queuedOffline'));
            setMode('list');
            return;
          } catch {
            // fall through
          }
        }
        toast.error(message);
      } finally {
        setBusy(false);
        setUploadProgress(null);
      }
    },
    [buildMeta, refreshList, refreshPending, t]
  );

  const flushPendingQueue = useCallback(async () => {
    if (flushingRef.current || !isOnline()) return;
    flushingRef.current = true;
    setFlushingQueue(true);
    try {
      const items = await listPendingUploads();
      for (const item of items) {
        try {
          setUploadProgress({
            phase: 'init',
            chunksTotal: 1,
            chunksSent: 0,
            percent: 1,
            message: t('flushingQueue'),
          });
          await uploadVideoInspectionResumable({
            video: item.video,
            frames: item.frames,
            meta: item.meta,
            onProgress: setUploadProgress,
          });
          await removePendingUpload(item.id);
        } catch (e: unknown) {
          await updatePendingUpload(item.id, {
            attempts: item.attempts + 1,
            lastError: e instanceof Error ? e.message : 'upload failed',
          });
        }
      }
      await refreshPending();
      if ((await countPendingUploads()) === 0) {
        toast.success(t('queueFlushed'));
      }
      void refreshList();
    } finally {
      flushingRef.current = false;
      setFlushingQueue(false);
      setUploadProgress(null);
    }
  }, [refreshList, refreshPending, t]);

  useEffect(() => {
    if (!online) return;
    void flushPendingQueue();
  }, [online, flushPendingQueue]);

  const startRecording = async () => {
    try {
      setTranscript('');
      const capture = new VideoCaptureSession();
      captureRef.current = capture;
      await capture.start({
        videoEl: videoRef.current,
        speechLang,
        preferFullscreen: true,
        onTranscript: (text) => setTranscript(text),
      });
      setRecording(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not access camera/microphone');
      await captureRef.current?.cancel();
      captureRef.current = null;
      setRecording(false);
    }
  };

  const stopRecordingAndUpload = async () => {
    const capture = captureRef.current;
    if (!capture) return;
    setBusy(true);
    setRecording(false);
    try {
      const result = await capture.stop();
      captureRef.current = null;
      setTranscript(result.transcript || transcript);
      await uploadBlob(result.blob, {
        durationSec: result.durationSec,
        recordingMode: result.recordingMode,
        frames: result.frames,
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not stop recording');
      await capture.cancel();
      captureRef.current = null;
      setBusy(false);
    }
  };

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    await uploadBlob(file, { recordingMode: 'upload', frames: [] });
  };

  const findingsToChecklist = (inspection: VideoInspectionDetail): ChecklistDraftRow[] => {
    if (inspection.findings && inspection.findings.length > 0) {
      return inspection.findings.map((f) => ({
        category: f.category,
        severity: (MPI_SEVERITIES.includes(f.severity as MpiSeverity)
          ? f.severity
          : 'ok') as MpiSeverity,
        note: f.note || '',
      }));
    }
    return defaultChecklistTemplate();
  };

  const applyDetail = (inspection: VideoInspectionDetail) => {
    setSelected(inspection);
    setReportDraft(inspection.report || '');
    setTranscript(inspection.transcript || '');
    setVehicleLabel(inspection.vehicleLabel || '');
    setCustomerName(inspection.customerName || '');
    setCustomerPhone(inspection.customerPhone || '');
    setVin(inspection.vin || '');
    setPhone(inspection.customerPhone || '');
    setChecklist(findingsToChecklist(inspection));
    setShareUrl(null);
  };

  const openDetail = async (id: string) => {
    setBusy(true);
    try {
      const { inspection } = await api.getVideoInspection(id);
      applyDetail(inspection);
      setMode('detail');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not open inspection');
    } finally {
      setBusy(false);
    }
  };

  const generateReport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (transcript !== selected.transcript) {
        await api.patchVideoInspection(selected.id, { transcript });
      }
      const { inspection } = await api.generateVideoInspectionReport(selected.id);
      applyDetail(inspection);
      toast.success('Customer report ready');
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Report generation failed');
    } finally {
      setBusy(false);
    }
  };

  const saveMetaAndReport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { inspection } = await api.patchVideoInspection(selected.id, {
        report: reportDraft,
        vehicleLabel: vehicleLabel || selected.vehicleLabel,
        customerName,
        customerPhone,
        vin,
        transcript,
      });
      applyDetail(inspection);
      toast.success('Saved');
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const saveChecklist = async () => {
    if (!selected) return;
    setSavingChecklist(true);
    try {
      const { inspection } = await api.putVideoInspectionFindings(
        selected.id,
        checklist.map((row, i) => ({
          category: row.category,
          severity: row.severity,
          note: row.note,
          sortOrder: i,
        }))
      );
      applyDetail(inspection);
      toast.success(t('checklistSaved'));
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not save checklist');
    } finally {
      setSavingChecklist(false);
    }
  };

  const updateChecklistRow = (index: number, patch: Partial<ChecklistDraftRow>) => {
    setChecklist((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addChecklistRow = () => {
    setChecklist((prev) => [...prev, { category: 'other', severity: 'ok', note: '' }]);
  };

  const removeChecklistRow = (index: number) => {
    setChecklist((prev) => prev.filter((_, i) => i !== index));
  };

  const createShare = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api.shareVideoInspection(selected.id);
      setShareUrl(result.url);
      await api.patchVideoInspection(selected.id, { deliveryChannel: 'link' });
      toast.success(t('linkCopied'));
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        // ignore
      }
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not create link');
    } finally {
      setBusy(false);
    }
  };

  const sendSms = async () => {
    if (!selected || !phone.trim()) return;
    setBusy(true);
    try {
      const result = await api.sendVideoInspectionSms(selected.id, phone.trim());
      setShareUrl(result.shareUrl);
      toast.success(`Text sent (…${result.phoneLast4})`);
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('smsDisabled'));
    } finally {
      setBusy(false);
    }
  };

  const progressBar =
    uploadProgress && busy ? (
      <div className="mb-4 benz-card p-3">
        <div className="flex items-center justify-between text-xs text-benz-secondary mb-1.5">
          <span>{uploadProgress.message || t('uploading')}</span>
          <span>{uploadProgress.percent}%</span>
        </div>
        <div className="h-2 rounded-full bg-benz-border/40 overflow-hidden">
          <div
            className="h-full bg-benz-blue transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, uploadProgress.percent))}%` }}
          />
        </div>
        {uploadProgress.chunksTotal > 1 ? (
          <p className="text-[11px] text-benz-muted mt-1">
            {uploadProgress.chunksSent}/{uploadProgress.chunksTotal} chunks
          </p>
        ) : null}
      </div>
    ) : null;

  const customerFields = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div>
        <label className="benz-label">{t('customerName')}</label>
        <input
          className="benz-input"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder={t('customerNamePlaceholder')}
          disabled={recording || busy}
        />
      </div>
      <div>
        <label className="benz-label">{t('customerPhone')}</label>
        <input
          className="benz-input"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder={t('phonePlaceholder')}
          disabled={recording || busy}
        />
      </div>
      <div>
        <label className="benz-label">{t('vehicleLabel')}</label>
        <input
          className="benz-input"
          value={vehicleLabel}
          onChange={(e) => setVehicleLabel(e.target.value)}
          placeholder={t('vehiclePlaceholder')}
          disabled={recording || busy}
        />
      </div>
      <div>
        <label className="benz-label">{t('vin')}</label>
        <input
          className="benz-input font-mono uppercase"
          value={vin}
          onChange={(e) => setVin(e.target.value.toUpperCase())}
          placeholder={t('vinPlaceholder')}
          maxLength={17}
          disabled={recording || busy}
        />
      </div>
    </div>
  );

  if (mode === 'create') {
    return (
      <div className="benz-page">
        <button
          type="button"
          className="benz-nav-back"
          onClick={() => {
            if (recording) return;
            setMode('list');
          }}
          disabled={recording}
        >
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <h2 className="benz-page-title">{t('newInspection')}</h2>
        <p className="benz-hint mb-2">{t('subtitle')}</p>
        <p className="text-[11px] text-benz-secondary mb-4">
          {t('captureHints')}
          {!online ? ` · ${t('offlineBanner')}` : ''}
        </p>

        {customerFields}
        {progressBar}

        <div className="benz-card overflow-hidden mb-4 bg-black relative">
          <video ref={videoRef} className="w-full aspect-video" muted playsInline />
          {recording ? (
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {t('recording')}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {!recording ? (
            <button
              type="button"
              className="primary-btn h-12 px-4 touch-target"
              disabled={busy}
              onClick={() => void startRecording()}
            >
              <Mic size={16} className="inline mr-2" />
              {t('startRecording')}
            </button>
          ) : (
            <button
              type="button"
              className="primary-btn h-12 px-4 touch-target bg-red-700"
              disabled={busy}
              onClick={() => void stopRecordingAndUpload()}
            >
              <Square size={16} className="inline mr-2" />
              {t('stopRecording')}
            </button>
          )}
          <button
            type="button"
            className="secondary-btn h-12 px-4 touch-target"
            disabled={busy || recording}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} className="inline mr-2" />
            {t('uploadVideo')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
          />
        </div>

        <label className="benz-label">{t('liveTranscript')}</label>
        <textarea
          className="benz-textarea min-h-[120px]"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={t('transcriptPlaceholder')}
          disabled={busy}
        />
        {busy && !uploadProgress ? (
          <p className="mt-3 text-sm text-benz-secondary flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} /> {t('processing')}
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === 'detail' && selected) {
    const counts = selected.severityCounts || { ok: 0, recommend: 0, urgent: 0 };
    return (
      <div className="benz-page">
        <button type="button" className="benz-nav-back" onClick={() => setMode('list')}>
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <h2 className="benz-page-title">{selected.title}</h2>
          <span className={`status-pill ${statusPillClass(selected.status)}`}>
            {selected.status}
          </span>
        </div>
        <p className="benz-hint mb-3">
          {selected.vehicleLabel || '—'}
          {selected.vinLast8 ? ` · …${selected.vinLast8}` : ''}
          {selected.customerPhoneLast4 ? ` · …${selected.customerPhoneLast4}` : ''}
          {selected.recordingMode ? ` · ${selected.recordingMode}` : ''}
        </p>
        <div className="flex flex-wrap gap-2 mb-4 text-xs">
          <span className="status-pill status-pill-valid">OK {counts.ok}</span>
          <span className="status-pill status-pill-warn">Recommend {counts.recommend}</span>
          <span className="status-pill status-pill-warn">Urgent {counts.urgent}</span>
        </div>

        {selected.mediaUrl ? (
          <div className="benz-card overflow-hidden mb-4 bg-black">
            <video
              className="w-full aspect-video"
              controls
              playsInline
              src={selected.mediaUrl}
              preload="metadata"
            />
          </div>
        ) : null}

        {customerFields}

        <div className="benz-card p-4 mb-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList size={18} className="text-benz-blue" />
              <div>
                <div className="font-semibold text-sm">{t('checklistTitle')}</div>
                <div className="benz-hint text-xs">{t('checklistHint')}</div>
              </div>
            </div>
            <button
              type="button"
              className="primary-btn h-10 px-3 text-xs"
              disabled={savingChecklist || busy}
              onClick={() => void saveChecklist()}
            >
              {savingChecklist ? t('savingChecklist') : t('saveChecklist')}
            </button>
          </div>
          <ul className="space-y-3">
            {checklist.map((row, index) => (
              <li
                key={`${row.category}-${index}`}
                className="rounded-lg border border-benz-border/60 p-3 space-y-2"
              >
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    className="benz-input flex-1 min-w-[10rem] text-sm"
                    value={row.category}
                    onChange={(e) => updateChecklistRow(index, { category: e.target.value })}
                    aria-label={t('category')}
                  >
                    {MPI_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {MPI_CATEGORY_LABELS[cat as MpiCategory] || mpiCategoryLabel(cat)}
                      </option>
                    ))}
                    {!MPI_CATEGORIES.includes(row.category as MpiCategory) ? (
                      <option value={row.category}>{mpiCategoryLabel(row.category)}</option>
                    ) : null}
                  </select>
                  <div className="flex gap-1" role="group" aria-label={t('severity')}>
                    {MPI_SEVERITIES.map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        className={`h-9 px-2.5 rounded-md text-xs font-semibold border transition-colors ${
                          row.severity === sev
                            ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
                            : 'border-benz-border/60 text-benz-secondary'
                        }`}
                        onClick={() => updateChecklistRow(index, { severity: sev })}
                      >
                        <span
                          className={`inline-block w-2 h-2 rounded-full mr-1.5 align-middle ${severityDotClass(sev)}`}
                        />
                        {MPI_SEVERITY_LABELS[sev]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="text-xs text-benz-secondary underline px-1"
                    onClick={() => removeChecklistRow(index)}
                  >
                    {t('removeFinding')}
                  </button>
                </div>
                <input
                  className="benz-input text-sm"
                  value={row.note}
                  onChange={(e) => updateChecklistRow(index, { note: e.target.value })}
                  placeholder={t('findingNotePlaceholder')}
                />
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary-btn h-10 px-3 mt-3 text-xs"
            onClick={addChecklistRow}
          >
            {t('addFinding')}
          </button>
        </div>

        <label className="benz-label">{t('liveTranscript')}</label>
        <textarea
          className="benz-textarea min-h-[100px] mb-4"
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
        />

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            className="primary-btn h-11 px-4"
            disabled={busy}
            onClick={() => void generateReport()}
          >
            {busy ? t('generatingReport') : t('generateReport')}
          </button>
          <button
            type="button"
            className="secondary-btn h-11 px-4"
            disabled={busy}
            onClick={() => void saveMetaAndReport()}
          >
            {t('saveDetails')}
          </button>
        </div>

        <label className="benz-label">{t('reportLabel')}</label>
        <textarea
          className="benz-textarea min-h-[220px] mb-4 font-mono text-sm"
          value={reportDraft}
          onChange={(e) => setReportDraft(e.target.value)}
        />

        <div className="benz-card p-4 space-y-3">
          <button
            type="button"
            className="secondary-btn h-11 px-4 w-full sm:w-auto"
            disabled={busy}
            onClick={() => void createShare()}
          >
            <Link2 size={16} className="inline mr-2" />
            {t('shareLink')}
          </button>
          {shareUrl ? (
            <p className="text-xs break-all text-benz-secondary">
              {shareUrl}{' '}
              <button
                type="button"
                className="text-benz-blue underline"
                onClick={() => {
                  void navigator.clipboard.writeText(shareUrl);
                  toast.success(t('linkCopied'));
                }}
              >
                {t('copyLink')}
              </button>
            </p>
          ) : null}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="benz-input flex-1"
              placeholder={t('phonePlaceholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <button
              type="button"
              className="primary-btn h-11 px-4"
              disabled={busy || !phone.trim()}
              onClick={() => void sendSms()}
            >
              {t('sendSms')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="benz-page">
      <button type="button" className="benz-nav-back" onClick={onBack}>
        <ArrowLeft size={18} /> Back
      </button>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="benz-page-title flex items-center gap-2">
            <Video size={22} /> {t('title')}
          </h2>
          <p className="benz-hint">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          className="primary-btn h-11 px-4 shrink-0 touch-target"
          onClick={() => {
            setSelected(null);
            setShareUrl(null);
            setTranscript('');
            setCustomerName('');
            setCustomerPhone('');
            setVin('');
            setVehicleLabel('');
            setChecklist(defaultChecklistTemplate());
            setMode('create');
          }}
        >
          {t('newInspection')}
        </button>
      </div>

      {!online ? (
        <div className="benz-card p-3 mb-4 flex items-center gap-2 text-sm text-benz-amber">
          <CloudOff size={16} />
          {t('offlineBanner')}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className="benz-card p-4 mb-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="font-semibold text-sm flex items-center gap-2">
              <CloudOff size={16} className="text-benz-amber" />
              {t('pendingUploads')} ({pending.length})
            </div>
            <button
              type="button"
              className="secondary-btn h-9 px-3 text-xs"
              disabled={!online || flushingQueue}
              onClick={() => void flushPendingQueue()}
            >
              <RefreshCw size={14} className={`inline mr-1 ${flushingQueue ? 'animate-spin' : ''}`} />
              {t('retryPending')}
            </button>
          </div>
          <ul className="space-y-1.5 text-xs text-benz-secondary">
            {pending.map((item) => (
              <li key={item.id} className="flex justify-between gap-2">
                <span>
                  {new Date(item.createdAt).toLocaleString()}
                  {item.meta.vehicleLabel ? ` · ${item.meta.vehicleLabel}` : ''}
                </span>
                <span className="text-benz-muted">
                  {Math.round(item.video.size / 1024)} KB
                  {item.attempts ? ` · try ${item.attempts}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {progressBar}

      <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label={t('statusBoard')}>
        <button
          type="button"
          role="tab"
          aria-selected={statusFilter === 'all'}
          className={`h-9 px-3 rounded-full text-xs font-semibold border ${
            statusFilter === 'all'
              ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
              : 'border-benz-border/60 text-benz-secondary'
          }`}
          onClick={() => setStatusFilter('all')}
        >
          {t('statusAll')} ({boardCounts.all || 0})
        </button>
        {MPI_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={statusFilter === status}
            className={`h-9 px-3 rounded-full text-xs font-semibold border ${
              statusFilter === status
                ? 'border-benz-blue bg-benz-blue/10 text-benz-blue'
                : 'border-benz-border/60 text-benz-secondary'
            }`}
            onClick={() => setStatusFilter(status)}
          >
            {t(`status${status.charAt(0).toUpperCase()}${status.slice(1)}` as 'statusDraft')} (
            {boardCounts[status] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <p className="benz-hint flex items-center gap-2">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </p>
      ) : filteredList.length === 0 ? (
        <p className="benz-hint">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {filteredList.map((item) => {
            const counts = item.severityCounts || { ok: 0, recommend: 0, urgent: 0 };
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="benz-card w-full text-left p-4 hover:border-benz-blue/40 transition-colors"
                  onClick={() => void openDetail(item.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm">{item.title}</div>
                    <span className={`status-pill shrink-0 ${statusPillClass(item.status)}`}>
                      {item.status}
                    </span>
                  </div>
                  <div className="text-xs text-benz-secondary mt-1">
                    {item.vehicleLabel || '—'}
                    {item.vinLast8 ? ` · …${item.vinLast8}` : ''}
                    {item.hasReport ? ` · ${t('hasReport')}` : ''}
                    {item.recordingMode ? ` · ${item.recordingMode}` : ''}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-benz-secondary">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${severityDotClass('ok')}`} />
                      {counts.ok}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${severityDotClass('recommend')}`} />
                      {counts.recommend}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${severityDotClass('urgent')}`} />
                      {counts.urgent}
                    </span>
                    <span className="text-benz-muted ml-auto">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
