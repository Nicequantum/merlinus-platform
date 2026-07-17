import { clientLog } from '@/lib/clientLog';

/** RO scan upload — balances Grok vision legibility with fast uplink transfer. */
export const RO_SCAN_UPLOAD_MAX_DIM = 1400;
export const RO_SCAN_UPLOAD_QUALITY = 0.82;
export const RO_SCAN_UPLOAD_SKIP_BYTES = 700_000;

const LOAD_IMAGE_TIMEOUT_MS = 15_000;
const TO_BLOB_TIMEOUT_MS = 15_000;

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

export async function compressImageForRoScan(file: File): Promise<File> {
  return compressImageForUpload(
    file,
    RO_SCAN_UPLOAD_MAX_DIM,
    RO_SCAN_UPLOAD_QUALITY,
    RO_SCAN_UPLOAD_SKIP_BYTES
  );
}

export async function compressImageForUpload(
  file: File,
  maxDim = 1600,
  quality = 0.72,
  skipBelowBytes = 900_000
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const started = Date.now();
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch (e) {
    clientLog.warn('image.compression_load_failed', {
      name: file.name,
      size: file.size,
      error: e instanceof Error ? e.message : 'unknown',
    });
    return file;
  }

  try {
    let { width, height } = img;
    if (Math.max(width, height) <= maxDim && file.size < skipBelowBytes) {
      return file;
    }
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;

    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToJpegBlob(canvas, quality);
    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    clientLog.info('image.compression_ok', {
      name: file.name,
      durationMs: Date.now() - started,
      outBytes: blob.size,
    });
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch (e) {
    clientLog.warn('image.compression_failed', {
      name: file.name,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : 'unknown',
    });
    return file;
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    const timer = window.setTimeout(() => {
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image load for compression timed out after 15s'));
    }, LOAD_IMAGE_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };
    img.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return withTimeout(
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to compress image'))),
        'image/jpeg',
        quality
      );
    }),
    TO_BLOB_TIMEOUT_MS,
    'Image compress encode'
  );
}
