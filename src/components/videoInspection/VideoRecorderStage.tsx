'use client';

/**
 * Enterprise MPI video recorder stage.
 * Phases: idle → live (preview) → recording/paused → review → (parent saves/uploads)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Camera,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Upload,
} from 'lucide-react';
import {
  formatBytes,
  formatRecordingTimer,
  VideoCaptureSession,
  type CaptureStopResult,
} from '@/lib/videoInspection/captureSession';

export type RecorderPhase = 'idle' | 'live' | 'recording' | 'paused' | 'stopping' | 'review';

export interface VideoRecorderStageProps {
  speechLang?: string;
  disabled?: boolean;
  busy?: boolean;
  uploadProgressPercent?: number | null;
  uploadMessage?: string | null;
  error?: string | null;
  onError?: (message: string) => void;
  onTranscript?: (text: string) => void;
  /** Called when user confirms Save on the review screen. */
  onSave: (result: CaptureStopResult) => void | Promise<void>;
  onPhaseChange?: (phase: RecorderPhase) => void;
  /** Optional file-upload fallback. */
  onUploadFile?: (file: File) => void | Promise<void>;
}

export function VideoRecorderStage({
  speechLang,
  disabled = false,
  busy = false,
  uploadProgressPercent = null,
  uploadMessage = null,
  error = null,
  onError,
  onTranscript,
  onSave,
  onPhaseChange,
  onUploadFile,
}: VideoRecorderStageProps) {
  const { t } = useTranslation('video');
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [supportsPause, setSupportsPause] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewResult, setReviewResult] = useState<CaptureStopResult | null>(null);
  const [opening, setOpening] = useState(false);

  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const reviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<VideoCaptureSession | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const reviewUrlRef = useRef<string | null>(null);

  const setPhaseSafe = useCallback(
    (next: RecorderPhase) => {
      setPhase(next);
      onPhaseChange?.(next);
    },
    [onPhaseChange]
  );

  const reportError = useCallback(
    (message: string) => {
      setLocalError(message);
      onError?.(message);
    },
    [onError]
  );

  const revokeReviewUrl = useCallback(() => {
    if (reviewUrlRef.current) {
      URL.revokeObjectURL(reviewUrlRef.current);
      reviewUrlRef.current = null;
    }
    setReviewUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      const session = captureRef.current;
      captureRef.current = null;
      if (session) void session.release();
      if (reviewUrlRef.current) {
        URL.revokeObjectURL(reviewUrlRef.current);
        reviewUrlRef.current = null;
      }
    };
  }, []);

  const waitForLiveVideoEl = useCallback(async (): Promise<HTMLVideoElement> => {
    setPhaseSafe('live');
    for (let i = 0; i < 30; i++) {
      if (liveVideoRef.current) return liveVideoRef.current;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
    if (liveVideoRef.current) return liveVideoRef.current;
    throw new Error('Camera preview is not ready — try again');
  }, [setPhaseSafe]);

  const openCamera = useCallback(async () => {
    if (disabled || busy || opening) return;
    setOpening(true);
    setLocalError(null);
    try {
      if (captureRef.current) {
        await captureRef.current.release();
        captureRef.current = null;
      }
      const videoEl = await waitForLiveVideoEl();

      const capture = new VideoCaptureSession();
      captureRef.current = capture;
      await capture.start({
        videoEl,
        fullscreenEl: stageRef.current,
        speechLang,
        preferFullscreen: false,
        previewOnly: true,
        onTranscript: (text) => onTranscript?.(text),
        onElapsed: (sec) => setElapsedSec(sec),
        onPausedChange: (paused) => setPhaseSafe(paused ? 'paused' : 'recording'),
        onError: (message) => reportError(message),
      });
      setSupportsPause(capture.supportsPause);
      setPhaseSafe('live');
      setElapsedSec(0);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Could not access camera/microphone';
      reportError(message);
      await captureRef.current?.release();
      captureRef.current = null;
      setPhaseSafe('idle');
    } finally {
      setOpening(false);
    }
  }, [
    busy,
    disabled,
    opening,
    onTranscript,
    reportError,
    setPhaseSafe,
    speechLang,
    waitForLiveVideoEl,
  ]);

  const startRecording = useCallback(async () => {
    if (disabled || busy) return;
    setLocalError(null);
    try {
      // Open camera if needed, then start recorder
      if (!captureRef.current || !captureRef.current.isPreviewOnly) {
        if (captureRef.current) {
          await captureRef.current.release();
          captureRef.current = null;
        }
        const videoEl = await waitForLiveVideoEl();
        const capture = new VideoCaptureSession();
        captureRef.current = capture;
        await capture.start({
          videoEl,
          fullscreenEl: stageRef.current,
          speechLang,
          preferFullscreen: true,
          previewOnly: false,
          onTranscript: (text) => onTranscript?.(text),
          onElapsed: (sec) => setElapsedSec(sec),
          onPausedChange: (paused) => setPhaseSafe(paused ? 'paused' : 'recording'),
          onError: (message) => reportError(message),
        });
        setSupportsPause(capture.supportsPause);
      } else {
        await captureRef.current.beginRecording(speechLang);
        setSupportsPause(captureRef.current.supportsPause);
      }
      setPhaseSafe('recording');
      setElapsedSec(0);
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Could not start recording';
      reportError(message);
      await captureRef.current?.release();
      captureRef.current = null;
      setPhaseSafe('idle');
    }
  }, [
    busy,
    disabled,
    onTranscript,
    reportError,
    setPhaseSafe,
    speechLang,
    waitForLiveVideoEl,
  ]);

  const stopRecording = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;
    setPhaseSafe('stopping');
    setLocalError(null);
    try {
      const result = await capture.stop();
      captureRef.current = null;
      revokeReviewUrl();
      const url = URL.createObjectURL(result.blob);
      reviewUrlRef.current = url;
      setReviewUrl(url);
      setReviewResult(result);
      setElapsedSec(result.durationSec);
      if (result.transcript) onTranscript?.(result.transcript);
      setPhaseSafe('review');
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not stop recording';
      reportError(message);
      await capture.release();
      captureRef.current = null;
      setPhaseSafe('idle');
      setElapsedSec(0);
    }
  }, [onTranscript, reportError, revokeReviewUrl, setPhaseSafe]);

  const togglePause = useCallback(() => {
    const capture = captureRef.current;
    if (!capture?.supportsPause) return;
    try {
      if (capture.isPaused) {
        capture.resume();
        setPhaseSafe('recording');
      } else {
        capture.pause();
        setPhaseSafe('paused');
      }
    } catch (e: unknown) {
      reportError(e instanceof Error ? e.message : 'Pause failed');
    }
  }, [reportError, setPhaseSafe]);

  const reRecord = useCallback(async () => {
    revokeReviewUrl();
    setReviewResult(null);
    setElapsedSec(0);
    setLocalError(null);
    setPhaseSafe('idle');
    // Auto re-open camera for faster second take
    await openCamera();
  }, [openCamera, revokeReviewUrl, setPhaseSafe]);

  const saveRecording = useCallback(async () => {
    if (!reviewResult || busy) return;
    setLocalError(null);
    try {
      await onSave(reviewResult);
      // Parent navigates away on success; keep review if it stays
    } catch (e: unknown) {
      reportError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [busy, onSave, reportError, reviewResult]);

  const displayError = error || localError;
  const isLive =
    phase === 'live' || phase === 'recording' || phase === 'paused' || phase === 'stopping';
  const isRecordingActive = phase === 'recording' || phase === 'paused';

  return (
    <div className="space-y-4">
      {/* Stage */}
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-2xl bg-black shadow-xl ring-1 ring-black/10"
      >
        {isLive ? (
          <video
            ref={liveVideoRef}
            className="aspect-video w-full bg-black object-cover"
            muted
            playsInline
            autoPlay
          />
        ) : phase === 'review' && reviewUrl ? (
          <video
            ref={reviewVideoRef}
            className="aspect-video w-full bg-black object-contain"
            controls
            playsInline
            preload="metadata"
            src={reviewUrl}
          />
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-gradient-to-b from-slate-900 to-black px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
              <Camera className="text-white" size={28} />
            </div>
            <p className="text-sm font-medium text-white">{t('recorderReadyTitle')}</p>
            <p className="max-w-xs text-xs text-white/60">{t('recorderReadyHint')}</p>
          </div>
        )}

        {/* Recording HUD */}
        {isRecordingActive ? (
          <>
            <div className="pointer-events-none absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    phase === 'paused' ? 'bg-amber-400' : 'bg-red-500 animate-pulse'
                  }`}
                />
                {phase === 'paused' ? t('paused') : t('recording')}
              </div>
              <div className="rounded-full bg-black/75 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-white shadow">
                {formatRecordingTimer(elapsedSec)}
              </div>
            </div>
            {/* Subtle red recording frame */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-inset ring-red-500/70" />
          </>
        ) : null}

        {phase === 'stopping' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-sm text-white">
              <Loader2 className="animate-spin" size={16} />
              {t('finalizingRecording')}
            </div>
          </div>
        ) : null}

        {busy && uploadProgressPercent != null ? (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-10">
            <div className="mb-1 flex items-center justify-between text-xs text-white/90">
              <span>{uploadMessage || t('uploading')}</span>
              <span>{uploadProgressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-red-500 transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, uploadProgressPercent))}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Controls */}
      {phase === 'idle' || phase === 'live' ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center gap-6">
            {phase === 'idle' ? (
              <button
                type="button"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-xl shadow-red-600/30 ring-4 ring-red-200 transition hover:bg-red-700 active:scale-95 disabled:opacity-50"
                disabled={disabled || busy || opening}
                onClick={() => void startRecording()}
                aria-label={t('startRecording')}
              >
                {opening ? (
                  <Loader2 className="animate-spin" size={28} />
                ) : (
                  <span className="h-7 w-7 rounded-full bg-white" />
                )}
              </button>
            ) : (
              <button
                type="button"
                className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-xl shadow-red-600/30 ring-4 ring-red-200 transition hover:bg-red-700 active:scale-95 disabled:opacity-50"
                disabled={disabled || busy}
                onClick={() => void startRecording()}
                aria-label={t('startRecording')}
              >
                <span className="h-7 w-7 rounded-full bg-white" />
              </button>
            )}
          </div>
          <p className="text-center text-xs text-benz-secondary">
            {phase === 'live' ? t('tapRecordToStart') : t('tapRecordToOpen')}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {phase === 'idle' ? (
              <button
                type="button"
                className="secondary-btn h-10 px-3 text-xs"
                disabled={disabled || busy || opening}
                onClick={() => void openCamera()}
              >
                <Camera size={14} className="mr-1.5 inline" />
                {t('openCamera')}
              </button>
            ) : null}
            {onUploadFile ? (
              <>
                <button
                  type="button"
                  className="secondary-btn h-10 px-3 text-xs"
                  disabled={disabled || busy || isRecordingActive}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={14} className="mr-1.5 inline" />
                  {t('uploadVideo')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void onUploadFile(file);
                    e.target.value = '';
                  }}
                />
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {isRecordingActive ? (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center justify-center gap-5">
            {supportsPause ? (
              <button
                type="button"
                className="flex h-12 w-12 items-center justify-center rounded-full border border-benz-border bg-white text-benz-primary shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
                disabled={disabled || busy}
                onClick={togglePause}
                aria-label={phase === 'paused' ? t('resumeRecording') : t('pauseRecording')}
              >
                {phase === 'paused' ? <Play size={20} /> : <Pause size={20} />}
              </button>
            ) : (
              <div className="h-12 w-12" />
            )}

            <button
              type="button"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-xl shadow-red-600/40 ring-4 ring-red-200 transition hover:bg-red-700 active:scale-95 disabled:opacity-50"
              disabled={disabled || busy}
              onClick={() => void stopRecording()}
              aria-label={t('stopRecording')}
            >
              <Square size={28} className="fill-white" />
            </button>

            <div className="h-12 w-12" />
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                phase === 'paused' ? 'bg-amber-400' : 'bg-red-600 animate-pulse'
              }`}
            />
            <span className="font-mono tabular-nums">{formatRecordingTimer(elapsedSec)}</span>
            {phase === 'paused' ? (
              <span className="text-xs font-medium text-amber-700">{t('paused')}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'review' && reviewResult ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-benz-border/60 bg-benz-surface px-3 py-2 text-xs text-benz-secondary">
            <span>
              {t('reviewReady')} · {formatRecordingTimer(reviewResult.durationSec)} ·{' '}
              {formatBytes(reviewResult.blob.size)}
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            <button
              type="button"
              className="secondary-btn h-12 flex-1 px-4 touch-target sm:flex-none"
              disabled={busy}
              onClick={() => {
                const el = reviewVideoRef.current;
                if (!el) return;
                if (el.paused) void el.play();
                else el.pause();
              }}
            >
              <Play size={16} className="mr-2 inline" />
              {t('playPreview')}
            </button>
            <button
              type="button"
              className="secondary-btn h-12 flex-1 px-4 touch-target sm:flex-none"
              disabled={busy}
              onClick={() => void reRecord()}
            >
              <RotateCcw size={16} className="mr-2 inline" />
              {t('reRecord')}
            </button>
            <button
              type="button"
              className="primary-btn h-12 flex-1 px-6 touch-target sm:flex-none bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={() => void saveRecording()}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="mr-2 inline animate-spin" />
                  {t('savingVideo')}
                </>
              ) : (
                <>
                  <Save size={16} className="mr-2 inline" />
                  {t('saveVideo')}
                </>
              )}
            </button>
          </div>
          {busy ? (
            <p className="text-center text-xs text-benz-secondary">
              <RefreshCw size={12} className="mr-1 inline animate-spin" />
              {uploadMessage || t('uploading')}
            </p>
          ) : null}
        </div>
      ) : null}

      {displayError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
        >
          {displayError}
        </div>
      ) : null}
    </div>
  );
}
