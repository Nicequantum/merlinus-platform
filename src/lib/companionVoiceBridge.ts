'use client';

type VoiceListener = (listening: boolean) => void;

const listeners = new Set<VoiceListener>();

export function subscribeCompanionVoice(listener: VoiceListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setCompanionVoiceListening(listening: boolean): void {
  for (const listener of listeners) listener(listening);
}