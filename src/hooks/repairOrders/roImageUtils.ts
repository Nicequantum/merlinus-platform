import type { ImageAttachment } from '@/types';
import { rebuildExtractedFromOcrTexts } from '@/utils/diagnosticParser';
import type { ExtractedData } from '@/types';

export function removeImageAtIndex(
  images: ImageAttachment[],
  ocrTexts: string[],
  imageId: string
): { nextImages: ImageAttachment[]; nextOcr: string[]; rebuilt: ExtractedData } | null {
  const index = images.findIndex((img) => img.id === imageId);
  if (index < 0) return null;
  const nextImages = images.filter((img) => img.id !== imageId);
  const nextOcr = ocrTexts.filter((_, i) => i !== index);
  return { nextImages, nextOcr, rebuilt: rebuildExtractedFromOcrTexts(nextOcr) };
}