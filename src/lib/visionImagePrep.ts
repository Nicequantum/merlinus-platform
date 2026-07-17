import 'server-only';

import sharp from 'sharp';

/** Max edge length sent to Grok vision — smaller payloads = faster API turnaround. */
export const VISION_IMAGE_MAX_DIM = 1280;
/** JPEG quality tuned for RO text legibility vs. upload size. */
export const VISION_JPEG_QUALITY = 80;

/**
 * Downscale and re-encode blob bytes for Grok vision input.
 * Skips work when the source is already small enough.
 */
export async function bufferToVisionDataUrl(
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const normalizedType = (contentType || 'image/jpeg').toLowerCase();
  if (!normalizedType.startsWith('image/')) {
    const base64 = bytes.toString('base64');
    return `data:${normalizedType};base64,${base64}`;
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
    const base64 = bytes.toString('base64');
    return `data:${normalizedType};base64,${base64}`;
  }
}