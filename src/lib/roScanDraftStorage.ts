'use client';

import type { ImageAttachment } from '@/types';

const STORAGE_KEY = 'merlin:ro-scan-draft';

export interface RoScanDraftEntry {
  id: string;
  name: string;
  attachment: ImageAttachment;
}

export function loadRoScanDraft(): RoScanDraftEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RoScanDraftEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRoScanDraft(entries: RoScanDraftEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota or private mode — non-fatal; in-memory pending still works for the session.
  }
}

export function clearRoScanDraft(): void {
  saveRoScanDraft([]);
}