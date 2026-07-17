/**
 * PR-M1b — browser capture session helpers.
 * Wake lock, orientation lock, reliable MediaRecorder start/stop.
 * Client-only (no server imports).
 */

export type CaptureRecordingMode = 'fullscreen' | 'standard';

export interface CaptureStartOptions {
  videoEl: HTMLVideoElement | null;
  speechLang?: string;
  preferFullscreen?: boolean;
  onTranscript?: (text: string) => void;
  onError?: (message: string) => void;
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
  onresult: ((event: {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  }) => void) | null;
  onerror: (() => void) | null;
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
  private finalTranscript = '';
  private videoEl: HTMLVideoElement | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private visibilityHandler: (() => void) | null = null;
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private usedFullscreen = false;

  get isRecording(): boolean {
    return this.recording;
  }

  async start(options: CaptureStartOptions): Promise<void> {
    if (this.recording) {
      throw new Error('Already recording');
    }

    this.videoEl = options.videoEl;
    this.onTranscript = options.onTranscript ?? null;
    this.chunks = [];
    this.frames = [];
    this.finalTranscript = '';
    this.usedFullscreen = false;

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

    if (this.videoEl) {
      this.videoEl.srcObject = stream;
      this.videoEl.muted = true;
      this.videoEl.playsInline = true;
      await this.videoEl.play().catch(() => undefined);

      if (options.preferFullscreen !== false) {
        try {
          if (this.videoEl.requestFullscreen) {
            await this.videoEl.requestFullscreen();
            this.usedFullscreen = true;
          }
        } catch {
          // browsers may block; continue without fullscreen
        }
      }
    }

    await this.acquireWakeLock();
    await this.lockOrientation();
    this.attachLifecycleGuards();

    const mime = pickRecorderMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder = recorder;
    this.startedAt = Date.now();
    // timeslice improves reliability if stop races or tab is backgrounded
    recorder.start(1000);
    this.recording = true;

    this.startLiveStt(options.speechLang);
    this.startFrameCapture();
  }

  async stop(): Promise<CaptureStopResult> {
    if (!this.recorder || !this.recording) {
      throw new Error('Not recording');
    }

    const recorder = this.recorder;
    const mimeType = recorder.mimeType || 'video/webm';

    // Capture a final frame before tearing down stream
    await this.captureFrame().catch(() => undefined);

    const blob = await new Promise<Blob>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        // Force-assemble whatever we have if onstop never fires
        resolve(new Blob(this.chunks, { type: mimeType }));
      }, 8000);

      recorder.onstop = () => {
        window.clearTimeout(timeout);
        resolve(new Blob(this.chunks, { type: mimeType }));
      };
      recorder.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Recording failed'));
      };

      try {
        if (recorder.state !== 'inactive') {
          recorder.requestData?.();
          recorder.stop();
        } else {
          window.clearTimeout(timeout);
          resolve(new Blob(this.chunks, { type: mimeType }));
        }
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error('Stop failed'));
      }
    });

    const durationSec = Math.max(1, (Date.now() - this.startedAt) / 1000);
    const frames = this.frames.slice(0, 8);
    const transcript = this.finalTranscript.trim();
    const recordingMode: CaptureRecordingMode = this.usedFullscreen ? 'fullscreen' : 'standard';

    await this.teardown();

    if (blob.size < 64) {
      throw new Error('Recording produced no usable video — try again');
    }

    return { blob, durationSec, mimeType, frames, transcript, recordingMode };
  }

  async cancel(): Promise<void> {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop();
      }
    } catch {
      // ignore
    }
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    this.recording = false;
    if (this.frameTimer != null) {
      window.clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.recognition = null;

    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;

    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }

    await this.releaseWakeLock();
    await this.unlockOrientation();
    await this.exitFullscreen();
    this.detachLifecycleGuards();
  }

  private startFrameCapture() {
    let count = 0;
    void this.captureFrame();
    this.frameTimer = window.setInterval(() => {
      if (!this.recording || count >= 7) {
        if (this.frameTimer != null) window.clearInterval(this.frameTimer);
        this.frameTimer = null;
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
        await orientation.lock('landscape');
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

  private async exitFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  }

  private attachLifecycleGuards() {
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.recording) {
        void this.acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (!this.recording) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
  }

  private detachLifecycleGuards() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }
}

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
    return 'video/webm;codecs=vp9,opus';
  }
  if (MediaRecorder.isTypeSupported('video/webm')) return 'video/webm';
  if (MediaRecorder.isTypeSupported('video/mp4')) return 'video/mp4';
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
