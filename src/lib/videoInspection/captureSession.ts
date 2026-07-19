/**
 * PR-M1b — browser Video MPI capture session.
 * MediaRecorder start/stop reliability, wake lock, orientation, fullscreen,
 * and guaranteed MediaStream teardown (camera light off on stop/navigate).
 * Client-only (no server imports).
 */

export type CaptureRecordingMode = 'fullscreen' | 'standard';

export interface CaptureStartOptions {
  /** Live preview element (required for recording). */
  videoEl: HTMLVideoElement | null;
  /**
   * Preferred element for native Fullscreen API (container).
   * Falls back to videoEl, then CSS immersive mode via onImmersiveChange.
   */
  fullscreenEl?: HTMLElement | null;
  speechLang?: string;
  preferFullscreen?: boolean;
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  /** Fired when entering/leaving immersive capture (native FS or CSS overlay). */
  onImmersiveChange?: (immersive: boolean) => void;
  /** Live elapsed seconds while recording (for UI timer). */
  onElapsed?: (seconds: number) => void;
}

export interface CaptureStopResult {
  blob: Blob;
  durationSec: number;
  mimeType: string;
  frames: Blob[];
  transcript: string;
  recordingMode: CaptureRecordingMode;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
};

type FullscreenCapable = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitRequestFullScreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

export class VideoCaptureSession {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private frames: Blob[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private orientationLocked = false;
  private recognition: SpeechRecognitionLike | null = null;
  private startedAt = 0;
  private frameTimer: number | null = null;
  private elapsedTimer: number | null = null;
  private recording = false;
  private stopping = false;
  private finalTranscript = '';
  private videoEl: HTMLVideoElement | null = null;
  private fullscreenEl: HTMLElement | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private onImmersiveChange: ((immersive: boolean) => void) | null = null;
  private onElapsed: ((seconds: number) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: ((e: PageTransitionEvent) => void) | null = null;
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private fullscreenChangeHandler: (() => void) | null = null;
  private usedFullscreen = false;
  private cssImmersive = false;
  private recorderMime = 'video/webm';

  get isRecording(): boolean {
    return this.recording;
  }

  get isImmersive(): boolean {
    return this.usedFullscreen || this.cssImmersive;
  }

  getElapsedSec(): number {
    if (!this.startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
  }

  async start(options: CaptureStartOptions): Promise<void> {
    if (this.recording || this.stopping) {
      throw new Error('Already recording');
    }
    if (!options.videoEl) {
      throw new Error('Video element is required for capture');
    }
    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser does not support video recording');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not available in this browser');
    }

    // Ensure any previous half-open session is fully released
    await this.forceReleaseHardware();

    this.videoEl = options.videoEl;
    this.fullscreenEl = options.fullscreenEl ?? options.videoEl;
    this.onTranscript = options.onTranscript ?? null;
    this.onImmersiveChange = options.onImmersiveChange ?? null;
    this.onElapsed = options.onElapsed ?? null;
    this.chunks = [];
    this.frames = [];
    this.finalTranscript = '';
    this.usedFullscreen = false;
    this.cssImmersive = false;

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
    this.stream = stream;

    // If camera dies mid-session, surface error
    stream.getTracks().forEach((track) => {
      track.onended = () => {
        if (this.recording && !this.stopping) {
          options.onError?.('Camera or microphone was disconnected');
        }
      };
    });

    const video = this.videoEl;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    // Wait for real video frames so MediaRecorder does not start on a black stream
    await waitForVideoReady(video, 4_000);

    if (options.preferFullscreen !== false) {
      await this.enterImmersive();
    }

    await this.acquireWakeLock();
    await this.lockOrientation();
    this.attachLifecycleGuards();

    const mime = pickRecorderMime();
    this.recorderMime = mime || 'video/webm';
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 2_500_000 });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch (error) {
        await this.forceReleaseHardware();
        throw error instanceof Error
          ? error
          : new Error('Could not start video recorder on this device');
      }
    }
    this.recorderMime = normalizeVideoMime(recorder.mimeType || this.recorderMime);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.recorder = recorder;
    this.startedAt = Date.now();

    // Prefer timeslice so we always accumulate chunks during recording.
    // Some iOS builds reject timeslice — fall back to bare start().
    try {
      recorder.start(1000);
    } catch {
      try {
        recorder.start();
      } catch (error) {
        await this.forceReleaseHardware();
        throw error instanceof Error
          ? error
          : new Error('Could not start recording');
      }
    }
    this.recording = true;
    this.onElapsed?.(0);
    this.startElapsedTimer();

    this.startLiveStt(options.speechLang);
    this.startFrameCapture();
  }

  async stop(): Promise<CaptureStopResult> {
    if (!this.recorder || !this.recording) {
      await this.forceReleaseHardware();
      throw new Error('Not recording');
    }
    if (this.stopping) {
      throw new Error('Already stopping');
    }
    this.stopping = true;
    this.recording = false;
    this.stopElapsedTimer();

    const recorder = this.recorder;
    const mimeType = normalizeVideoMime(recorder.mimeType || this.recorderMime || 'video/webm');

    // Final still before stream teardown
    await this.captureFrame().catch(() => undefined);
    this.stopFrameTimer();
    this.stopRecognition();

    const blob = await this.finalizeRecorder(recorder, mimeType);

    const durationSec = Math.max(1, Math.round((Date.now() - this.startedAt) / 1000));
    const frames = this.frames.slice(0, 8);
    const transcript = this.finalTranscript.trim();
    const recordingMode: CaptureRecordingMode =
      this.usedFullscreen || this.cssImmersive ? 'fullscreen' : 'standard';

    // Always release camera before returning — even if blob is tiny
    await this.teardown();

    // Normalize blob type (some browsers return empty type)
    const typedBlob =
      blob.type && blob.type !== 'application/octet-stream'
        ? blob
        : new Blob([blob], { type: mimeType });

    if (typedBlob.size < 256) {
      throw new Error('Recording produced no usable video — try again or upload a file');
    }

    return {
      blob: typedBlob,
      durationSec,
      mimeType: normalizeVideoMime(typedBlob.type || mimeType),
      frames,
      transcript,
      recordingMode,
    };
  }

  async cancel(): Promise<void> {
    this.recording = false;
    this.stopping = true;
    this.stopElapsedTimer();
    try {
      const recorder = this.recorder;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
    await this.teardown();
  }

  /** Public hard release for navigation / unmount (idempotent). */
  async release(): Promise<void> {
    // Do not interrupt an in-flight finalize — that yields empty blobs.
    if (this.stopping && this.recorder) {
      return;
    }
    this.recording = false;
    this.stopping = true;
    this.stopElapsedTimer();
    await this.forceReleaseHardware();
  }

  private finalizeRecorder(recorder: MediaRecorder, mimeType: string): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (blob: Blob) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(blob);
      };

      const timeout = window.setTimeout(() => {
        // Assemble whatever chunks we have if onstop never fires
        finish(new Blob(this.chunks, { type: mimeType }));
      }, 12_000);

      const previousOnStop = recorder.onstop;
      const previousOnError = recorder.onerror;

      const assembleWithGrace = () => {
        // Classic bug: onstop can fire before the final ondataavailable.
        // Wait briefly for late chunks before accepting an empty assembly.
        const attempt = (triesLeft: number) => {
          if (this.chunks.length > 0 || triesLeft <= 0) {
            finish(new Blob(this.chunks, { type: mimeType }));
            return;
          }
          window.setTimeout(() => attempt(triesLeft - 1), 40);
        };
        attempt(8);
      };

      recorder.onstop = (ev) => {
        try {
          previousOnStop?.call(recorder, ev);
        } catch {
          // ignore
        }
        assembleWithGrace();
      };

      recorder.onerror = (ev) => {
        try {
          previousOnError?.call(recorder, ev as ErrorEvent);
        } catch {
          // ignore
        }
        window.clearTimeout(timeout);
        if (!settled) {
          if (this.chunks.length > 0) {
            settled = true;
            resolve(new Blob(this.chunks, { type: mimeType }));
          } else {
            settled = true;
            reject(new Error('Recording failed'));
          }
        }
      };

      try {
        if (recorder.state === 'inactive') {
          assembleWithGrace();
          return;
        }
        // Flush buffered data then stop — order matters on Chromium
        try {
          if (recorder.state === 'recording') {
            recorder.requestData();
          }
        } catch {
          // requestData not supported or invalid state
        }
        // Give requestData a tick to enqueue before stop() on slow devices
        window.setTimeout(() => {
          try {
            if (recorder.state !== 'inactive') {
              recorder.stop();
            } else if (!settled) {
              assembleWithGrace();
            }
          } catch (error) {
            window.clearTimeout(timeout);
            if (!settled) {
              if (this.chunks.length > 0) {
                settled = true;
                resolve(new Blob(this.chunks, { type: mimeType }));
              } else {
                settled = true;
                reject(error instanceof Error ? error : new Error('Stop failed'));
              }
            }
          }
        }, 30);
      } catch (error) {
        window.clearTimeout(timeout);
        if (!settled) {
          if (this.chunks.length > 0) {
            settled = true;
            resolve(new Blob(this.chunks, { type: mimeType }));
          } else {
            settled = true;
            reject(error instanceof Error ? error : new Error('Stop failed'));
          }
        }
      }
    });
  }

  private async teardown(): Promise<void> {
    this.recording = false;
    this.stopElapsedTimer();
    this.stopFrameTimer();
    this.stopRecognition();
    this.stopAllTracks();
    this.recorder = null;
    this.chunks = [];

    if (this.videoEl) {
      try {
        this.videoEl.pause();
      } catch {
        // ignore
      }
      this.videoEl.srcObject = null;
      try {
        this.videoEl.load();
      } catch {
        // ignore
      }
    }

    await this.releaseWakeLock();
    await this.unlockOrientation();
    await this.exitImmersive();
    this.detachLifecycleGuards();
    this.stopping = false;
  }

  private async forceReleaseHardware(): Promise<void> {
    this.recording = false;
    this.stopElapsedTimer();
    this.stopFrameTimer();
    this.stopRecognition();
    this.stopAllTracks();
    this.recorder = null;
    if (this.videoEl) {
      try {
        this.videoEl.pause();
      } catch {
        // ignore
      }
      this.videoEl.srcObject = null;
    }
    await this.releaseWakeLock();
    await this.unlockOrientation();
    await this.exitImmersive();
    this.detachLifecycleGuards();
    this.stopping = false;
  }

  private stopAllTracks(): void {
    const tracks = this.stream?.getTracks() ?? [];
    for (const track of tracks) {
      try {
        track.onended = null;
        track.stop();
      } catch {
        // ignore
      }
    }
    this.stream = null;

    // Also clear any tracks still attached to the video element
    const src = this.videoEl?.srcObject;
    if (src instanceof MediaStream) {
      for (const track of src.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
    }
  }

  private stopFrameTimer() {
    if (this.frameTimer != null) {
      window.clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
  }

  private startElapsedTimer() {
    this.stopElapsedTimer();
    this.elapsedTimer = window.setInterval(() => {
      if (!this.recording) return;
      this.onElapsed?.(this.getElapsedSec());
    }, 250);
  }

  private stopElapsedTimer() {
    if (this.elapsedTimer != null) {
      window.clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
  }

  private stopRecognition() {
    try {
      this.recognition?.stop();
      this.recognition?.abort?.();
    } catch {
      // ignore
    }
    this.recognition = null;
  }

  private startFrameCapture() {
    let count = 0;
    void this.captureFrame();
    this.frameTimer = window.setInterval(() => {
      if (!this.recording || count >= 7) {
        this.stopFrameTimer();
        return;
      }
      void this.captureFrame();
      count += 1;
    }, 4000);
  }

  private async captureFrame(): Promise<void> {
    const video = this.videoEl;
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
    if (blob) this.frames.push(blob);
  }

  private startLiveStt(speechLang?: string) {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor() as SpeechRecognitionLike;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = speechLang || 'en-US';
    let finalText = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]![0]!.transcript;
        if (event.results[i]!.isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      this.finalTranscript = `${finalText}${interim}`.trim();
      this.onTranscript?.(this.finalTranscript);
    };
    recognition.onerror = () => {
      // keep recording if STT fails
    };
    try {
      recognition.start();
      this.recognition = recognition;
    } catch {
      // ignore
    }
  }

  private async enterImmersive(): Promise<void> {
    const target = (this.fullscreenEl || this.videoEl) as FullscreenCapable | null;
    if (!target) {
      this.enableCssImmersive();
      return;
    }

    // Prefer Fullscreen API on the *container* — never video.webkitEnterFullscreen.
    // iOS video fullscreen detaches the element into a native player and can
    // produce empty MediaRecorder output even though the camera light stays on.
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        this.usedFullscreen = true;
        this.onImmersiveChange?.(true);
        return;
      }
      if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
        this.usedFullscreen = true;
        this.onImmersiveChange?.(true);
        return;
      }
      if (target.webkitRequestFullScreen) {
        await target.webkitRequestFullScreen();
        this.usedFullscreen = true;
        this.onImmersiveChange?.(true);
        return;
      }
      if (target.msRequestFullscreen) {
        await target.msRequestFullscreen();
        this.usedFullscreen = true;
        this.onImmersiveChange?.(true);
        return;
      }
    } catch {
      // fall through to CSS immersive
    }

    // CSS immersive overlay (reliable on iOS when FS is blocked)
    this.enableCssImmersive();
  }

  private enableCssImmersive() {
    this.cssImmersive = true;
    this.onImmersiveChange?.(true);
  }

  private async exitImmersive(): Promise<void> {
    try {
      const doc = document as Document & {
        webkitFullscreenElement?: Element | null;
        webkitExitFullscreen?: () => Promise<void> | void;
        msExitFullscreen?: () => Promise<void> | void;
      };
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      }
    } catch {
      // ignore
    }
    this.usedFullscreen = false;
    if (this.cssImmersive) {
      this.cssImmersive = false;
    }
    this.onImmersiveChange?.(false);
  }

  private async acquireWakeLock() {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
      };
      if (nav.wakeLock?.request) {
        this.wakeLock = await nav.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => {
          // re-acquire if still recording when user returns
        });
      }
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLock?.release();
    } catch {
      // ignore
    }
    this.wakeLock = null;
  }

  private async lockOrientation() {
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (orientation: string) => Promise<void>;
      };
      if (orientation?.lock) {
        try {
          await orientation.lock('landscape');
        } catch {
          await orientation.lock('any');
        }
        this.orientationLocked = true;
      }
    } catch {
      this.orientationLocked = false;
    }
  }

  private async unlockOrientation() {
    if (!this.orientationLocked) return;
    try {
      screen.orientation?.unlock?.();
    } catch {
      // ignore
    }
    this.orientationLocked = false;
  }

  private attachLifecycleGuards() {
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.recording) {
        void this.acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    // iOS Safari: pagehide is more reliable than unload for releasing camera.
    // Never kill hardware while stop() is finalizing — that yields empty videos.
    this.pageHideHandler = () => {
      if (this.stopping) return;
      if (this.recording || this.stream) {
        void this.forceReleaseHardware();
      }
    };
    window.addEventListener('pagehide', this.pageHideHandler);

    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (!this.recording) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);

    this.fullscreenChangeHandler = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const active = Boolean(document.fullscreenElement || doc.webkitFullscreenElement);
      if (!active && this.recording && this.usedFullscreen && !this.cssImmersive) {
        // User exited native FS mid-record — keep recording via CSS immersive
        this.usedFullscreen = false;
        this.enableCssImmersive();
      }
    };
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener('webkitfullscreenchange', this.fullscreenChangeHandler as EventListener);
  }

  private detachLifecycleGuards() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.pageHideHandler) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = null;
    }
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
    if (this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      document.removeEventListener(
        'webkitfullscreenchange',
        this.fullscreenChangeHandler as EventListener
      );
      this.fullscreenChangeHandler = null;
    }
  }
}

function waitForVideoReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.videoWidth > 2 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (video.videoWidth > 2 && video.readyState >= 2) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, 50);
    };
    tick();
  });
}

/** Strip codecs / normalize browser MediaRecorder MIME for server allowlists. */
export function normalizeVideoMime(mime: string | undefined | null): string {
  const raw = (mime || '').split(';')[0]?.trim().toLowerCase() || '';
  if (raw === 'video/webm' || raw === 'video/mp4' || raw === 'video/quicktime' || raw === 'video/x-matroska') {
    return raw;
  }
  if (raw.includes('mp4') || raw.includes('quicktime')) return 'video/mp4';
  if (raw.includes('webm')) return 'video/webm';
  if (raw.includes('matroska')) return 'video/x-matroska';
  return raw || 'video/webm';
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Prefer widely supported types. Avoid advertising codecs that break server allowlists.
  const candidates = isAppleMobile()
    ? ['video/mp4', 'video/webm', 'video/webm;codecs=vp8,opus']
    : [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
      ];
  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // ignore
    }
  }
  return undefined;
}

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ desktop UA
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

export function formatRecordingTimer(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
