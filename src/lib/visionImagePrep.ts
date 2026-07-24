import 'server-only';

/** Max edge length sent to Grok vision — smaller payloads = faster API turnaround. */
export const VISION_IMAGE_MAX_DIM = 1280;
/** JPEG quality tuned for RO text legibility vs. upload size. */
export const VISION_JPEG_QUALITY = 80;

/** Minimal sharp factory surface used for vision prep (avoids fragile default-export typings). */
type SharpPipeline = {
  metadata: () => Promise<{ width?: number; height?: number }>;
  rotate: () => SharpPipeline;
  resize: (opts: {
    width: number;
    height: number;
    fit: string;
    withoutEnlargement: boolean;
  }) => SharpPipeline;
  jpeg: (opts: { quality: number; mozjpeg: boolean }) => SharpPipeline;
  toBuffer: () => Promise<Buffer>;
};

type SharpFactory = (input: Buffer, options?: { failOn?: string }) => SharpPipeline;

/**
 * Dynamic sharp load — never static-import.
 * Cloudflare Workers / OpenNext cannot load sharp's native bindings; a static
 * `import sharp` crashed every route that pulled in `@/lib/blob` (upload, images,
 * extract) into HTML 500 before withAuth could return JSON.
 */
async function tryLoadSharp(): Promise<SharpFactory | null> {
  try {
    const mod = await import('sharp');
    const factory = (mod as { default?: SharpFactory }).default ?? (mod as unknown as SharpFactory);
    return typeof factory === 'function' ? factory : null;
  } catch {
    return null;
  }
}

function asDataUrl(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

/**
 * Downscale and re-encode blob bytes for Grok vision input.
 * Falls back to raw base64 when sharp is unavailable (Workers) or fails.
 */
export async function bufferToVisionDataUrl(
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const normalizedType = (contentType || 'image/jpeg').toLowerCase();
  if (!normalizedType.startsWith('image/')) {
    return asDataUrl(bytes, normalizedType);
  }

  const sharp = await tryLoadSharp();
  if (!sharp) {
    return asDataUrl(bytes, normalizedType);
  }

  try {
    const image = sharp(bytes, { failOn: 'none' });
    const meta = await image.metadata();
    const maxEdge = Math.max(meta.width ?? 0, meta.height ?? 0);

    let pipeline = image.rotate();
    if (maxEdge > VISION_IMAGE_MAX_DIM) {
      pipeline = pipeline.resize({
        width: VISION_IMAGE_MAX_DIM,
        height: VISION_IMAGE_MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const output = await pipeline
      .jpeg({ quality: VISION_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    return `data:image/jpeg;base64,${output.toString('base64')}`;
  } catch {
    return asDataUrl(bytes, normalizedType);
  }
}
