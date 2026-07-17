import type { VoiceInputSettings } from './voiceSettings';

/**
 * Lowers the confidence bar as ambient noise rises.
 * Shop-floor tablets often yield lower Web Speech confidence scores even when
 * transcripts are usable — rejecting everything would frustrate technicians.
 */
export function computeAdaptiveConfidenceThreshold(
  noiseLevel: number,
  settings: Pick<VoiceInputSettings, 'baseConfidenceThreshold' | 'minConfidenceThreshold' | 'noiseAdjustmentFactor'>
): number {
  const clampedNoise = Math.min(100, Math.max(0, noiseLevel));
  const noiseFactor = clampedNoise / 100;
  const adjusted =
    settings.baseConfidenceThreshold - noiseFactor * settings.noiseAdjustmentFactor;
  return Math.max(settings.minConfidenceThreshold, Math.min(1, adjusted));
}

/**
 * Accept transcripts when Web Speech omits confidence (common in Chrome).
 * Gate only when a low confidence score is explicitly provided.
 */
export function passesConfidenceGate(
  confidence: number | null | undefined,
  threshold: number,
  _noiseLevel = 0
): boolean {
  // Chrome/Edge often report 0 instead of omitting confidence — treat as unavailable.
  if (confidence == null || Number.isNaN(confidence) || confidence <= 0) {
    return true;
  }
  return confidence >= threshold;
}