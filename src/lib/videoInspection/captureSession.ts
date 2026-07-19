/**
 * Enterprise Video MPI capture session.
 * High-quality MediaRecorder capture, pause/resume, reliable finalize,
 * wake lock, orientation, immersive stage, guaranteed stream teardown.
 * Client-only (no server imports).
 */

export type CaptureRecordingMode = 'fullscreen' | 'standard';

export interface CaptureStartOptions {
  /** Live preview element (required). */
  videoEl: HTMLVideoElement | null;
  /** Preferred Fullscreen API target (container). */
  fullscreenEl?: HTMLElement | null;
  speechLang?: string;
  preferFullscreen?: boolean;
  /** When true, open camera for live preview without starting MediaRecorder. */
  previewOnly?: boolean;
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
  onImmersiveChange?: (immersive: boolean) => void;
  /** Active recording elapsed seconds (excludes pause). */
  onElapsed?: (seconds: number) => void;
  onPausedChange?: (paused: boolean) => void;
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

const VIDEO_CONSTRAINT_LADDER: MediaStreamConstraints[] = [
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30, min: 24 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: { ideal: 1 },
    },
  },
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, min: 15 },
    },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  },
  {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 960 },
      height: { ideal: 540 },
    },
    audio: true,
  },
  {
    video: { facingMode: 'user' },
    audio: true,
  },
];

export class VideoCaptureSession {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private frames: Blob[] = [];
  private wakeLock: WakeLockSentinel | null = null;
  private orientationLocked = false;
  private recognition: SpeechRecognitionLike | null = null;
  private startedAt = 0;
  private accumulatedMs = 0;
  private pauseStartedAt = 0;
  private frameTimer: number | null = null;
  private elapsedTimer: number | null = null;
  private recording = false;
  private paused = false;
  private previewOnly = false;
  private stopping = false;
  private finalTranscript = '';
  private videoEl: HTMLVideoElement | null = null;
  private fullscreenEl: HTMLElement | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private onImmersiveChange: ((immersive: boolean) => void) | null = null;
  private onElapsed: ((seconds: number) => void) | null = null;
  private onPausedChange: ((paused: boolean) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private pageHideHandler: ((e: PageTransitionEvent) => void) | null = null;
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private fullscreenChangeHandler: (() => void) | null = null;
  private usedFullscreen = false;
  private cssImmersive = false;
  private recorderMime = 'video/webm';
  private videoBitsPerSecond = 4_000_000;

  get isRecording(): boolean {
    return this.recording;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isPreviewOnly(): boolean {
    return this.previewOnly && !this.recording;
  }

  get isImmersive(): boolean {
    return this.usedFullscreen || this.cssImmersive;
  }

  get supportsPause(): boolean {
    const rec = this.recorder;
    return Boolean(
      rec &&
        typeof rec.pause === 'function' &&
        typeof rec.resume === 'function' &&
        // Safari iOS historically lacks reliable pause
        !isAppleMobile()
    );
  }

  getElapsedSec(): number {
    return Math.max(0, Math.floor(this.getElapsedMs() / 1000));
  }

  private getElapsedMs(): number {
    if (!this.startedAt && this.accumulatedMs === 0) return 0;
    if (this.paused || !this.recording) {
      return this.accumulatedMs;
    }
    return this.accumulatedMs + (Date.now() - this.startedAt);
  }

  /**
   * Open the best available camera for live preview (or start recording immediately).
   */
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

    await this.forceReleaseHardware();

    this.videoEl = options.videoEl;
    this.fullscreenEl = options.fullscreenEl ?? options.videoEl;
    this.onTranscript = options.onTranscript ?? null;
    this.onImmersiveChange = options.onImmersiveChange ?? null;
    this.onElapsed = options.onElapsed ?? null;
    this.onPausedChange = options.onPausedChange ?? null;
    this.onError = options.onError ?? null;
    this.chunks = [];
    this.frames = [];
    this.finalTranscript = '';
    this.usedFullscreen = false;
    this.cssImmersive = false;
    this.paused = false;
    this.accumulatedMs = 0;
    this.pauseStartedAt = 0;
    this.previewOnly = Boolean(options.previewOnly);

    const stream = await openBestCameraStream();
    this.stream = stream;
    this.videoBitsPerSecond = pickBitrateForStream(stream);

    stream.getTracks().forEach((track) => {
      track.onended = () => {
        if ((this.recording || this.previewOnly) && !this.stopping) {
          this.onError?.('Camera or microphone was disconnected');
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
    await waitForVideoReady(video, 5_000);

    if (options.preferFullscreen !== false) {
      await this.enterImmersive();
    }

    await this.acquireWakeLock();
    await this.lockOrientation();
    this.attachLifecycleGuards();

    if (this.previewOnly) {
      // Live view only — user taps Record to begin MediaRecorder
      return;
    }

    await this.beginRecorder(options.speechLang);
  }

  /** Start MediaRecorder on an already-open preview stream. */
  async beginRecording(speechLang?: string): Promise<void> {
    if (this.recording || this.stopping) {
      throw new Error('Already recording');
    }
    if (!this.stream) {
      throw new Error('Camera is not open — start capture first');
    }
    this.previewOnly = false;
    this.chunks = [];
    this.frames = [];
    this.accumulatedMs = 0;
    this.paused = false;
    await this.beginRecorder(speechLang);
  }

  private async beginRecorder(speechLang?: string): Promise<void> {
    if (!this.stream) throw new Error('No camera stream');

    const mime = pickRecorderMime();
    this.recorderMime = mime || 'video/webm';
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(this.stream, {
            mimeType: mime,
            videoBitsPerSecond: this.videoBitsPerSecond,
            audioBitsPerSecond: 128_000,
          })
        : new MediaRecorder(this.stream, {
            videoBitsPerSecond: this.videoBitsPerSecond,
            audioBitsPerSecond: 128_000,
          });
    } catch {
      try {
        recorder = new MediaRecorder(this.stream);
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
    this.accumulatedMs = 0;

    try {
      recorder.start(500);
    } catch {
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
    }

    this.recording = true;
    this.paused = false;
    this.onElapsed?.(0);
    this.onPausedChange?.(false);
    this.startElapsedTimer();
    this.startLiveStt(speechLang);
    this.startFrameCapture();
  }

  pause(): void {
    if (!this.recording || this.paused || this.stopping) return;
    const rec = this.recorder;
    if (!rec || typeof rec.pause !== 'function') {
      throw new Error('Pause is not supported on this device');
    }
    if (rec.state !== 'recording') return;
    try {
      rec.pause();
    } catch {
      throw new Error('Could not pause recording');
    }
    this.accumulatedMs += Date.now() - this.startedAt;
    this.pauseStartedAt = Date.now();
    this.paused = true;
    this.onPausedChange?.(true);
    this.onElapsed?.(this.getElapsedSec());
  }

  resume(): void {
    if (!this.recording || !this.paused || this.stopping) return;
    const rec = this.recorder;
    if (!rec || typeof rec.resume !== 'function') {
      throw new Error('Resume is not supported on this device');
    }
    try {
      rec.resume();
    } catch {
      throw new Error('Could not resume recording');
    }
    this.startedAt = Date.now();
    this.pauseStartedAt = 0;
    this.paused = false;
    this.onPausedChange?.(false);
    this.onElapsed?.(this.getElapsedSec());
  }

  async stop(): Promise<CaptureStopResult> {
    // Allow stop from recording or paused state
    if (!this.recorder || (!this.recording && !this.paused)) {
      await this.forceReleaseHardware();
      throw new Error('Not recording');
    }
    if (this.stopping) {
      throw new Error('Already stopping');
    }
    this.stopping = true;

    // Resume if paused so stop can flush cleanly
    if (this.paused && this.recorder.state === 'paused') {
      try {
        this.recorder.resume();
      } catch {
        // continue stop
      }
      this.paused = false;
    }

    if (this.recording && !this.paused) {
      this.accumulatedMs += Date.now() - this.startedAt;
    }
    this.recording = false;
    this.stopElapsedTimer();

    const recorder = this.recorder;
    const mimeType = normalizeVideoMime(recorder.mimeType || this.recorderMime || 'video/webm');

    await this.captureFrame().catch(() => undefined);
    this.stopFrameTimer();
    this.stopRecognition();

    const blob = await this.finalizeRecorder(recorder, mimeType);
    const durationSec = Math.max(1, Math.round(this.accumulatedMs / 1000));
    const frames = this.frames.slice(0, 8);
    const transcript = this.finalTranscript.trim();
    const recordingMode: CaptureRecordingMode =
      this.usedFullscreen || this.cssImmersive ? 'fullscreen' : 'standard';

    await this.teardown();

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
    this.paused = false;
    this.previewOnly = false;
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

  async release(): Promise<void> {
    if (this.stopping && this.recorder) {
      return;
    }
    this.recording = false;
    this.paused = false;
    this.previewOnly = false;
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
        finish(new Blob(this.chunks, { type: mimeType }));
      }, 15_000);

      const assembleWithGrace = () => {
        // onstop can fire before the final ondataavailable — wait for late chunks.
        const attempt = (triesLeft: number) => {
          if (this.chunks.length > 0 || triesLeft <= 0) {
            finish(new Blob(this.chunks, { type: mimeType }));
            return;
          }
          window.setTimeout(() => attempt(triesLeft - 1), 50);
        };
        attempt(12);
      };

      recorder.onstop = () => {
        assembleWithGrace();
      };

      recorder.onerror = () => {
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
        try {
          if (recorder.state === 'recording' || recorder.state === 'paused') {
            if (recorder.state === 'paused') {
              try {
                recorder.resume();
              } catch {
                // ignore
              }
            }
            recorder.requestData();
          }
        } catch {
          // ignore
        }
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
        }, 40);
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
    this.paused = false;
    this.previewOnly = false;
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
    this.paused = false;
    this.previewOnly = false;
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
      if (!this.recording || this.paused) return;
      this.onElapsed?.(this.getElapsedSec());
    }, 200);
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
      if (!this.recording || this.paused || count >= 7) {
        if (count >= 7) this.stopFrameTimer();
        return;
      }
      void this.captureFrame();
      count += 1;
    }, 3500);
  }

  private async captureFrame(): Promise<void> {
    const video = this.videoEl;
    if (!video || video.videoWidth < 2) return;
    const canvas = document.createElement('canvas');
    const maxW = 1280;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
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

    // Never use video.webkitEnterFullscreen — empty MediaRecorder blobs on iOS.
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
      // CSS immersive
    }

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
          try {
            await orientation.lock('any');
          } catch {
            // ignore
          }
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
        this.usedFullscreen = false;
        this.enableCssImmersive();
      }
    };
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    document.addEventListener(
      'webkitfullscreenchange',
      this.fullscreenChangeHandler as EventListener
    );
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

async function openBestCameraStream(): Promise<MediaStream> {
  let lastError: unknown;
  for (const constraints of VIDEO_CONSTRAINT_LADDER) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Could not access camera or microphone');
}

function pickBitrateForStream(stream: MediaStream): number {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.() || {};
  const height = settings.height || 720;
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 4_500_000;
  return 2_500_000;
}

function waitForVideoReady(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.videoWidth > 2 && video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const start = Date.now();
    const onReady = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      window.clearInterval(poll);
    };
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('canplay', onReady);
    const poll = window.setInterval(() => {
      if (video.videoWidth > 2 && video.readyState >= 2) {
        onReady();
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        cleanup();
        resolve();
      }
    }, 40);
  });
}

export function normalizeVideoMime(mime: string | undefined | null): string {
  const raw = (mime || '').split(';')[0]?.trim().toLowerCase() || '';
  if (
    raw === 'video/webm' ||
    raw === 'video/mp4' ||
    raw === 'video/quicktime' ||
    raw === 'video/x-matroska'
  ) {
    return raw;
  }
  if (raw.includes('mp4') || raw.includes('quicktime')) return 'video/mp4';
  if (raw.includes('webm')) return 'video/webm';
  if (raw.includes('matroska')) return 'video/x-matroska';
  return raw || 'video/webm';
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
