import type { VoiceInputSettings } from './voiceSettings';

/**
 * Monitors microphone RMS level via Web Audio API.
 * SpeechRecognition does not expose noise metrics — a parallel getUserMedia stream
 * with AGC/noise suppression constraints improves consistency on shop-floor tablets.
 */
export class NoiseMonitor {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private data: Uint8Array | null = null;
  private level = 0;
  /** H12: cap UI updates at 4 Hz — rAF alone caused ~60 React re-renders/sec. */
  private static readonly EMIT_INTERVAL_MS = 250;

  constructor(private readonly onLevel: (level: number) => void) {}

  get currentLevel(): number {
    return this.level;
  }

  async start(settings: Pick<VoiceInputSettings, 'autoGainControl' | 'noiseSuppression' | 'echoCancellation'>): Promise<void> {
    await this.stop();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: settings.autoGainControl,
        noiseSuppression: settings.noiseSuppression,
        echoCancellation: settings.echoCancellation,
      },
      video: false,
    });

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.82;
    source.connect(analyser);

    this.stream = stream;
    this.audioContext = audioContext;
    this.analyser = analyser;
    const sampleBuffer = new Uint8Array(analyser.fftSize);
    this.data = sampleBuffer;

    const sampleLevel = () => {
      if (!this.analyser || !this.data) return 0;
      this.analyser.getByteTimeDomainData(this.data as Uint8Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < this.data.length; i++) {
        const sample = (this.data[i] - 128) / 128;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / this.data.length);
      return Math.min(100, Math.round(rms * 420));
    };

    const tick = () => {
      if (!this.analyser || !this.data) return;
      this.level = sampleLevel();
      this.rafId = requestAnimationFrame(tick);
    };

    const emit = () => {
      this.onLevel(this.level);
      this.throttleTimer = setTimeout(emit, NoiseMonitor.EMIT_INTERVAL_MS);
    };

    this.rafId = requestAnimationFrame(tick);
    this.level = sampleLevel();
    this.onLevel(this.level);
    this.throttleTimer = setTimeout(emit, NoiseMonitor.EMIT_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.throttleTimer != null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // ignore close races during rapid restart
      }
    }
    this.audioContext = null;
    this.analyser = null;
    this.data = null;
    this.level = 0;
    this.onLevel(0);
  }
}