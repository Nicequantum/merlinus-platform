'use client';

const STORAGE_KEY = 'merlin_companion_device_id';

/** Stable per-browser device id — used to ignore self-echoed WebSocket events. */
export function getCompanionDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}