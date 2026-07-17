'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Link2, Loader2, Mic, Square, Upload, Video } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { localeToSpeechLang, normalizePreferredLanguage } from '@/lib/i18n/locales';
import type { TechnicianSession, VideoInspectionDetail, VideoInspectionSummary } from '@/types';
import { getSpeechRecognitionCtor } from '@/lib/voice/speechRecognition';

interface VideoInspectionViewProps {
  session: TechnicianSession;
  onBack: () => void;
}

export function VideoInspectionView({ session, onBack }: VideoInspectionViewProps) {
  const { t } = useTranslation('video');
  const [list, setList] = useState<VideoInspectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VideoInspectionDetail | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'detail'>('list');
  const [vehicleLabel, setVehicleLabel] = useState('');
  const [transcript, setTranscript] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [reportDraft, setReportDraft] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const framesRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const startTimeRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const stopStream = () => {
    mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    mediaStreamRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
  };

  useEffect(() => () => stopStream(), []);

  const startLiveStt = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang;
    let finalText = '';
    recognition.onresult = (event: {
      resultIndex: number;
      results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
    }) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]![0]!.transcript;
        if (event.results[i]!.isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      setLiveTranscript(`${finalText}${interim}`.trim());
      setTranscript(`${finalText}${interim}`.trim());
    };
    recognition.onerror = () => {
      // keep recording even if STT fails
    };
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // ignore
    }
  };

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2) return;
    const canvas = document.createElement('canvas');
    const maxW = 960;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
    );
    if (blob) framesRef.current.push(blob);
  };

  const startRecording = async () => {
    try {
      framesRef.current = [];
      chunksRef.current = [];
      setLiveTranscript('');
      setTranscript('');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : 'video/mp4';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      startLiveStt();

      // Capture keyframes every ~4s (max 8)
      let frameCount = 0;
      const frameTimer = window.setInterval(() => {
        if (frameCount >= 8 || !recording) {
          window.clearInterval(frameTimer);
          return;
        }
        void captureFrame();
        frameCount += 1;
      }, 4000);
      void captureFrame();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not access camera/microphone');
      stopStream();
    }
  };

  const stopRecordingAndUpload = async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setBusy(true);
    setRecording(false);

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    recognitionRef.current?.stop();
    void captureFrame();
    stopStream();

    const durationSec = Math.max(1, (Date.now() - startTimeRef.current) / 1000);
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
    await uploadBlob(blob, durationSec);
  };

  const uploadBlob = async (blob: Blob, durationSec?: number) => {
    setBusy(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      form.append('file', blob, `inspection.${ext}`);
      form.append('title', 'Video inspection');
      if (vehicleLabel.trim()) form.append('vehicleLabel', vehicleLabel.trim());
      form.append('transcript', transcript || liveTranscript);
      form.append(
        'transcriptLanguage',
        normalizePreferredLanguage(session.preferredLanguage)
      );
      if (durationSec) form.append('durationSec', String(durationSec));
      for (const [i, frame] of framesRef.current.slice(0, 8).entries()) {
        form.append('frames', frame, `frame-${i}.jpg`);
      }

      const { inspection } = await api.uploadVideoInspection(form);
      setSelected(inspection);
      setReportDraft(inspection.report || '');
      setMode('detail');
      toast.success('Video saved');
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    framesRef.current = [];
    await uploadBlob(file);
  };

  const openDetail = async (id: string) => {
    setBusy(true);
    try {
      const { inspection } = await api.getVideoInspection(id);
      setSelected(inspection);
      setReportDraft(inspection.report || '');
      setTranscript(inspection.transcript || '');
      setShareUrl(null);
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
      setSelected(inspection);
      setReportDraft(inspection.report || '');
      toast.success('Customer report ready');
      void refreshList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Report generation failed');
    } finally {
      setBusy(false);
    }
  };

  const saveReport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { inspection } = await api.patchVideoInspection(selected.id, {
        report: reportDraft,
        vehicleLabel: vehicleLabel || selected.vehicleLabel,
      });
      setSelected(inspection);
      toast.success('Report saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const createShare = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await api.shareVideoInspection(selected.id);
      setShareUrl(result.url);
      toast.success(t('linkCopied'));
      try {
        await navigator.clipboard.writeText(result.url);
      } catch {
        // ignore
      }
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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('smsDisabled'));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'create') {
    return (
      <div className="benz-page">
        <button type="button" className="benz-nav-back" onClick={() => setMode('list')}>
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <h2 className="benz-page-title">{t('newInspection')}</h2>
        <p className="benz-hint mb-4">{t('subtitle')}</p>

        <label className="benz-label">{t('vehicleLabel')}</label>
        <input
          className="benz-input mb-4"
          value={vehicleLabel}
          onChange={(e) => setVehicleLabel(e.target.value)}
          placeholder={t('vehiclePlaceholder')}
        />

        <div className="benz-card overflow-hidden mb-4 bg-black">
          <video ref={videoRef} className="w-full aspect-video" muted playsInline />
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
            className="hidden"
            onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
          />
        </div>

        <label className="benz-label">{t('liveTranscript')}</label>
        <textarea
          className="benz-textarea min-h-[120px]"
          value={transcript || liveTranscript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={t('transcriptPlaceholder')}
        />
        {busy ? (
          <p className="mt-3 text-sm text-benz-secondary flex items-center gap-2">
            <Loader2 className="animate-spin" size={16} /> Uploading…
          </p>
        ) : null}
      </div>
    );
  }

  if (mode === 'detail' && selected) {
    return (
      <div className="benz-page">
        <button type="button" className="benz-nav-back" onClick={() => setMode('list')}>
          <ArrowLeft size={18} /> {t('back')}
        </button>
        <h2 className="benz-page-title">{selected.title}</h2>
        <p className="benz-hint mb-3">
          {selected.vehicleLabel || '—'} · {selected.status}
        </p>

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
            onClick={() => void saveReport()}
          >
            Save report
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
            setLiveTranscript('');
            setMode('create');
          }}
        >
          {t('newInspection')}
        </button>
      </div>

      {loading ? (
        <p className="benz-hint flex items-center gap-2">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="benz-hint">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="benz-card w-full text-left p-4 hover:border-benz-blue/40 transition-colors"
                onClick={() => void openDetail(item.id)}
              >
                <div className="font-semibold text-sm">{item.title}</div>
                <div className="text-xs text-benz-secondary mt-1">
                  {item.vehicleLabel || '—'} · {item.status}
                  {item.hasReport ? ' · report' : ''}
                </div>
                <div className="text-xs text-benz-muted mt-1">
                  {new Date(item.createdAt).toLocaleString()}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
