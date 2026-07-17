import Tesseract from 'tesseract.js';
import { clientLog } from '@/lib/clientLog';

/** Default per-recognize() ceiling (diagnostics / legacy paths). */
const OCR_TIMEOUT_MS = 120_000;
/** Per-pass budget for RO scan OCR fallback — Grok vision is the primary path. */
export const RO_SCAN_PASS_TIMEOUT_MS = 90_000;
/** Diagnostic Xentry fallback — fail fast so the queue workflow never hangs at ~58%. */
export const DIAGNOSTIC_OCR_PASS_TIMEOUT_MS = 35_000;
/** OCR fallback resolution — Grok vision handles fine detail. */
export const RO_SCAN_MAX_DIM = 1600;
/** Downscale retry target when a pass hits the timeout on very large photos. */
const RO_SCAN_RETRY_MAX_DIM = 1280;
const MAX_DIM_FAST = 1600;
const MAX_DIM_FULL = 2200;
const MAX_DIM_SCREENSHOT = 2400;

const TESSERACT_OPTS = {
  workerPath: '/tesseract/worker.min.js',
  langPath: '/tesseract',
  corePath: '/tesseract',
  gzip: true,
  workerBlobURL: false,
} as const;

let sharedWorker: Tesseract.Worker | null = null;
let workerInitPromise: Promise<Tesseract.Worker> | null = null;
let progressListener: ((p: number) => void) | null = null;
/** Serialize recognize() — the shared Tesseract worker is not safe for parallel jobs. */
let ocrJobChain: Promise<unknown> = Promise.resolve();

/** Worker create can hang on cold first-load of WASM — hard-fail so callers can recover. */
const WORKER_INIT_TIMEOUT_MS = 20_000;
/** terminate() can hang forever after a soft-timed-out recognize — never await unboundedly. */
const WORKER_TERMINATE_TIMEOUT_MS = 2_000;
const LOAD_IMAGE_TIMEOUT_MS = 15_000;
const CANVAS_TO_BLOB_TIMEOUT_MS = 15_000;

function withOcrLock<T>(fn: () => Promise<T>): Promise<T> {
  const job = ocrJobChain.then(() => fn());
  ocrJobChain = job.then(() => undefined).catch(() => undefined);
  return job;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Soft timeout alone leaves Tesseract.recognize running on the shared worker and wedges
 * every later OCR job until full page reload. Hard-reset the worker on timeout/failure.
 *
 * Critical: never `await worker.terminate()` without a ceiling — hung terminate was the
 * cold-start / first-scan "loading forever" wedge after a soft OCR timeout.
 */
async function hardResetOcrWorker(reason: string): Promise<void> {
  clientLog.warn('ocr.worker_hard_reset', { reason });
  progressListener = null;
  const worker = sharedWorker;
  sharedWorker = null;
  workerInitPromise = null;
  // Drop the chain so a hung recognize cannot block forever behind a dead promise.
  ocrJobChain = Promise.resolve();
  if (!worker) return;

  try {
    await withTimeout(
      Promise.resolve().then(() => worker.terminate()),
      WORKER_TERMINATE_TIMEOUT_MS,
      'OCR worker terminate'
    );
    clientLog.info('ocr.worker_terminated', { reason });
  } catch (error) {
    clientLog.warn('ocr.worker_terminate_timed_out_or_failed', {
      reason,
      error: error instanceof Error ? error.message : 'unknown',
    });
    // Detach — do not block the scan pipeline if terminate never settles.
    void Promise.resolve()
      .then(() => worker.terminate())
      .catch(() => undefined);
  }
}

async function getSharedWorker(): Promise<Tesseract.Worker> {
  if (sharedWorker) return sharedWorker;
  if (!workerInitPromise) {
    workerInitPromise = (async () => {
      const started = Date.now();
      clientLog.info('ocr.worker_init_start');
      try {
        const worker = await withTimeout(
          Tesseract.createWorker('eng', 1, {
            ...TESSERACT_OPTS,
            logger: (message) => {
              if (message.status === 'recognizing text' && progressListener) {
                progressListener(Math.round(message.progress * 100));
              }
            },
          }),
          WORKER_INIT_TIMEOUT_MS,
          'OCR worker init'
        );
        sharedWorker = worker;
        clientLog.info('ocr.worker_init_ready', { durationMs: Date.now() - started });
        return worker;
      } catch (error) {
        workerInitPromise = null;
        sharedWorker = null;
        clientLog.error('ocr.worker_init_failed', {
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : 'unknown',
        });
        throw error;
      }
    })();
  }
  return workerInitPromise;
}

export async function shutdownOcrWorker(): Promise<void> {
  await hardResetOcrWorker('shutdown');
}

/** True when a shared Tesseract worker is already created (warm path). */
export function isOcrWorkerReady(): boolean {
  return sharedWorker !== null;
}

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for OCR (timeout)'));
    }, LOAD_IMAGE_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image for OCR'));
    };
    img.src = objectUrl;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: 'image/png' | 'image/jpeg' = 'image/png',
  quality = 0.92
): Promise<Blob> {
  return withTimeout(
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode preprocessed image'))),
        mime,
        quality
      );
    }),
    CANVAS_TO_BLOB_TIMEOUT_MS,
    'OCR canvas encode'
  );
}

/** Faded / yellow paper / shadow-heavy scans — stronger contrast, lower binarization threshold. */
async function preprocessFaded(file: File | Blob, maxDim = MAX_DIM_FAST): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = Math.round(Math.max(r, g, b) * 0.72 + Math.min(r, g, b) * 0.28);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 2.4 + 128)));
      const binary = v > 125 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = binary;
    }

    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas, 'image/png', 0.92);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

/** Fast preprocess for shop-floor mobile devices — no multi-angle deskew. */
async function preprocessFast(file: File | Blob, maxDim = MAX_DIM_FAST): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 1.8 + 128)));
      const binary = v > 140 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = binary;
    }

    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas, 'image/png', 0.92);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

/** Legacy heavy preprocess — deskew + sharpen; avoid on mobile scan paths. */
async function preprocessFull(file: File): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let canvas = document.createElement('canvas');
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > MAX_DIM_FULL) {
      const scale = MAX_DIM_FULL / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = w;
    canvas.height = h;
    let ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);

    let imageData = ctx.getImageData(0, 0, w, h);
    let data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }

    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 2.2 + 128)));
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    const threshold = 140;
    for (let i = 0; i < data.length; i += 4) {
      const v = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
    }

    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas);
  } catch (e) {
    clientLog.warn('ocr.preprocess_full_failed', e);
    return file;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

async function preprocessScreenshot(file: File): Promise<Blob> {
  const img = await loadImage(file);
  try {
    let w = img.width;
    let h = img.height;
    if (Math.max(w, h) > MAX_DIM_SCREENSHOT) {
      const scale = MAX_DIM_SCREENSHOT / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      data[i] = data[i + 1] = data[i + 2] = gray;
    }
    let minV = 255;
    let maxV = 0;
    for (let i = 0; i < data.length; i += 4) {
      minV = Math.min(minV, data[i]);
      maxV = Math.max(maxV, data[i]);
    }
    const range = Math.max(1, maxV - minV);
    for (let i = 0; i < data.length; i += 4) {
      let v = Math.round(((data[i] - minV) / range) * 255);
      v = Math.min(255, Math.max(0, Math.round((v - 128) * 1.6 + 128)));
      data[i] = data[i + 1] = data[i + 2] = v;
    }
    ctx.putImageData(imageData, 0, 0);
    return await canvasToBlob(canvas);
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

export async function preprocessImageForOCR(
  file: File,
  mode: 'fast' | 'full' | 'screenshot' = 'fast'
): Promise<Blob> {
  try {
    if (mode === 'full') return await preprocessFull(file);
    if (mode === 'screenshot') return await preprocessScreenshot(file);
    return await preprocessFast(file);
  } catch (e) {
    clientLog.warn('ocr.preprocess_failed', e);
    return file;
  }
}

type OcrPageSegMode = '4' | '6' | '11';

export async function warmupOcrWorker(): Promise<void> {
  const alreadyReady = sharedWorker !== null;
  const started = Date.now();
  await getSharedWorker();
  clientLog.info('ocr.warmup_complete', {
    durationMs: Date.now() - started,
    alreadyReady,
  });
}

export async function runOCR(
  imageSource: Blob | File,
  onProgress?: (p: number) => void,
  pageSegMode: OcrPageSegMode = '6',
  relaxedChars = false,
  timeoutMs = OCR_TIMEOUT_MS
): Promise<string> {
  return withOcrLock(async () => {
    const localProgress = onProgress ?? null;
    progressListener = localProgress;
    const stageStarted = Date.now();
    const recognize = async () => {
      const worker = await getSharedWorker();
      clientLog.info('ocr.recognize_start', {
        pageSegMode,
        warm: true,
        initToRecognizeMs: Date.now() - stageStarted,
      });
      const ocrOptions: Record<string, string> = {
        tessedit_pageseg_mode: pageSegMode,
        tessedit_oem: '3',
      };
      if (!relaxedChars) {
        ocrOptions.tessedit_char_whitelist =
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;/-_()[]#%&*+=@\'" \n';
      }
      const {
        data: { text },
      } = await worker.recognize(imageSource as File, ocrOptions);
      return text;
    };

    if (localProgress) localProgress(5);

    try {
      const text = await withTimeout(recognize(), timeoutMs, 'On-device OCR');
      if (localProgress) localProgress(100);
      clientLog.info('ocr.recognize_ok', { durationMs: Date.now() - stageStarted });
      return text;
    } catch (error) {
      clientLog.warn('ocr.recognize_failed', {
        durationMs: Date.now() - stageStarted,
        error: error instanceof Error ? error.message : 'unknown',
      });
      // Soft timeout / recognize failure leaves the worker mid-job — reset so the next
      // scan does not hang until the user restarts the app.
      await hardResetOcrWorker(
        error instanceof Error ? error.message : 'recognize_failed'
      );
      throw error;
    } finally {
      if (progressListener === localProgress) {
        progressListener = null;
      }
    }
  });
}

const COMPLAINT_LINE_RE = /^#\s*[A-Z]\b/i;
const PLAIN_LETTER_COMPLAINT_RE = /^[A-Z][\.\)\:\s\-–—]+\s*\S/i;

function isComplaintRelevantOcrLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (COMPLAINT_LINE_RE.test(trimmed)) return true;
  if (PLAIN_LETTER_COMPLAINT_RE.test(trimmed)) return true;
  if (/^LINE\s+OP/i.test(trimmed)) return true;
  if (/^(?:customer\s+states|cust(?:omer)?\s+states?)/i.test(trimmed)) return true;
  return false;
}

/**
 * Merge OCR passes without scrambling document order.
 * Uses the longest pass as the structural base; appends only missing # A–F lines from other passes.
 */
export function mergeOcrTextPasses(...passes: string[]): string {
  const nonEmpty = passes.map((p) => p?.trim()).filter(Boolean) as string[];
  if (nonEmpty.length === 0) return '';
  if (nonEmpty.length === 1) return nonEmpty[0];

  let primary = nonEmpty[0];
  for (const pass of nonEmpty) {
    if (pass.length > primary.length) primary = pass;
  }

  const primaryLines = primary.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set(primaryLines.map((l) => l.toLowerCase()));
  const extras: string[] = [];

  for (const pass of nonEmpty) {
    if (pass === primary) continue;
    for (const raw of pass.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      if (!isComplaintRelevantOcrLine(line)) continue;
      extras.push(line);
      seen.add(key);
    }
  }

  return [...primaryLines, ...extras].join('\n');
}

export type OcrPassMode = 'color' | 'grayscale' | 'enhanced';

export interface OcrPassResult {
  mode: OcrPassMode;
  text: string;
}

export interface MultiPassOcrResult {
  passes: OcrPassResult[];
  mergedText: string;
}

function isOcrTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

async function downscaleImageSource(source: File | Blob, maxDim: number, fileName: string): Promise<File> {
  const img = await loadImage(source);
  try {
    const maxSide = Math.max(img.width, img.height);
    if (maxSide <= maxDim && source instanceof File) return source;

    const scale = maxDim / Math.max(maxSide, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source instanceof File ? source : new File([source], fileName, { type: source.type || 'image/png' });

    ctx.drawImage(img, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, 'image/png', 0.92);
    return new File([blob], fileName, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

/** Downscale only extremely large camera photos — preserve detail up to RO_SCAN_MAX_DIM. */
async function prepareRoScanSource(file: File): Promise<File> {
  try {
    return await downscaleImageSource(file, RO_SCAN_MAX_DIM, file.name || 'ro-scan.png');
  } catch (error) {
    clientLog.warn('ocr.ro_scan_downscale_failed', error);
    return file;
  }
}

async function runRoScanOcrPass(
  imageSource: Blob | File,
  onProgress: ((p: number) => void) | undefined,
  progressStart: number,
  progressSpan: number
): Promise<string> {
  const report = onProgress
    ? (p: number) => onProgress(progressStart + Math.round((p / 100) * progressSpan))
    : undefined;

  try {
    return await runOCR(imageSource, report, '6', false, RO_SCAN_PASS_TIMEOUT_MS);
  } catch (error) {
    if (!isOcrTimeoutError(error)) throw error;
    const retrySource = await downscaleImageSource(
      imageSource,
      RO_SCAN_RETRY_MAX_DIM,
      imageSource instanceof File ? imageSource.name : 'ro-scan-retry.png'
    );
    return await runOCR(retrySource, report, '6', false, RO_SCAN_PASS_TIMEOUT_MS);
  }
}

/**
 * Fast single-pass RO OCR — used when Grok vision runs in parallel (fallback / merge only).
 */
export async function runFastRoScanOcr(
  file: File,
  onProgress?: (p: number) => void
): Promise<MultiPassOcrResult> {
  const scanSource = await prepareRoScanSource(file);
  const pass1 = await runRoScanOcrPass(scanSource, onProgress, 0, 100);
  return {
    passes: [{ mode: 'color', text: pass1 }],
    mergedText: pass1,
  };
}

/**
 * Three-pass RO OCR: color → high-contrast B&W → enhanced contrast.
 * All preprocessing runs in parallel; each pass retries once at lower resolution on timeout.
 */
export async function runMultiPassOCR(
  file: File,
  onProgress?: (p: number) => void
): Promise<MultiPassOcrResult> {
  const scanSource = await prepareRoScanSource(file);
  const [highContrast, enhanced] = await Promise.all([
    preprocessFast(scanSource, RO_SCAN_MAX_DIM),
    preprocessFaded(scanSource, RO_SCAN_MAX_DIM),
  ]);

  const pass1 = await runRoScanOcrPass(scanSource, onProgress, 0, 34);
  const pass2 = await runRoScanOcrPass(highContrast, onProgress, 34, 33);
  const pass3 = await runRoScanOcrPass(enhanced, onProgress, 67, 33);

  const passes: OcrPassResult[] = [
    { mode: 'color', text: pass1 },
    { mode: 'grayscale', text: pass2 },
    { mode: 'enhanced', text: pass3 },
  ];

  if (onProgress) onProgress(100);

  return {
    passes,
    mergedText: mergeOcrTextPasses(pass1, pass2, pass3),
  };
}

/** Optimized for XENTRY / UI screenshots — two fast passes; Grok vision is primary. */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export async function runDiagnosticOCR(
  file: File,
  onProgress?: (p: number) => void,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const signal = options?.signal;
  throwIfAborted(signal);

  const screenshot = await preprocessImageForOCR(file, 'screenshot');
  throwIfAborted(signal);

  const pass1 = await runOCR(
    screenshot,
    onProgress ? (p) => onProgress(Math.round(p * 0.55)) : undefined,
    '6',
    true,
    DIAGNOSTIC_OCR_PASS_TIMEOUT_MS
  );
  throwIfAborted(signal);

  const pass2 = await runOCR(
    file,
    onProgress ? (p) => onProgress(55 + Math.round(p * 0.45)) : undefined,
    '11',
    true,
    DIAGNOSTIC_OCR_PASS_TIMEOUT_MS
  );
  throwIfAborted(signal);
  return mergeOcrTextPasses(pass1, pass2);
}