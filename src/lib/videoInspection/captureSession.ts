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

type VideoFullscreenCapable = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitEnterFullScreen?: () => void;
  webkitSupportsFullscreen?: boolean;
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
  private recording = false;
  private stopping = false;
  private finalTranscript = '';
  private videoEl: HTMLVideoElement | null = null;
  private fullscreenEl: HTMLElement | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private onImmersiveChange: ((immersive: boolean) => void) | null = null;
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
      recorder = new MediaRecorder(stream);
    }
    this.recorderMime = recorder.mimeType || this.recorderMime;

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.recorder = recorder;
    this.startedAt = Date.now();

    // iOS/Safari often mishandles timeslice; only use it on non-iOS.
    if (isAppleMobile()) {
      recorder.start();
    } else {
      recorder.start(1000);
    }
    this.recording = true;

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

    const recorder = this.recorder;
    const mimeType = recorder.mimeType || this.recorderMime || 'video/webm';

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
      mimeType: typedBlob.type || mimeType,
      frames,
      transcript,
      recordingMode,
    };
  }

  async cancel(): Promise<void> {
    this.recording = false;
    this.stopping = true;
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
    this.recording = false;
    this.stopping = true;
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
      }, 10_000);

      const previousOnStop = recorder.onstop;
      const previousOnError = recorder.onerror;

      recorder.onstop = (ev) => {
        try {
          previousOnStop?.call(recorder, ev);
        } catch {
          // ignore
        }
        finish(new Blob(this.chunks, { type: mimeType }));
      };

      recorder.onerror = (ev) => {
        try {
          previousOnError?.call(recorder, ev as ErrorEvent);
        } catch {
          // ignore
        }
        window.clearTimeout(timeout);
        if (!settled) {
          settled = true;
          // Prefer partial data over hard fail if we got any chunks
          if (this.chunks.length > 0) {
            resolve(new Blob(this.chunks, { type: mimeType }));
          } else {
            reject(new Error('Recording failed'));
          }
        }
      };

      try {
        if (recorder.state === 'inactive') {
          finish(new Blob(this.chunks, { type: mimeType }));
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
        recorder.stop();
      } catch (error) {
        window.clearTimeout(timeout);
        if (!settled) {
          settled = true;
          if (this.chunks.length > 0) {
            resolve(new Blob(this.chunks, { type: mimeType }));
          } else {
            reject(error instanceof Error ? error : new Error('Stop failed'));
          }
        }
      }
    });
  }

  private async teardown(): Promise<void> {
    this.recording = false;
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

    // 1) Standard Fullscreen API on container (best on Android Chrome / desktop)
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
      // fall through
    }

    // 2) iOS Safari video element fullscreen (legacy)
    const video = this.videoEl as VideoFullscreenCapable | null;
    if (video?.webkitEnterFullscreen || video?.webkitEnterFullScreen) {
      try {
        video.webkitEnterFullscreen?.();
        video.webkitEnterFullScreen?.();
        this.usedFullscreen = true;
        this.onImmersiveChange?.(true);
        return;
      } catch {
        // fall through
      }
    }

    // 3) CSS immersive overlay (reliable on iOS when FS is blocked)
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
        // Prefer landscape for MPI walkaround; fall back to any if blocked
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

    // iOS Safari: pagehide is more reliable than unload for releasing camera
    this.pageHideHandler = () => {
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

function isAppleMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ desktop UA
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Safari/iOS prefers mp4; Chromium prefers webm
  const candidates = isAppleMobile()
    ? ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
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
