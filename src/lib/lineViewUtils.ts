import { WARRANTY_STORY_MAX_CHARS, WARRANTY_STORY_WARN_CHARS } from '@/types';

export function complaintLabel(labels: string[] | undefined, index: number): string {
  return labels?.[index] || String.fromCharCode(65 + index);
}

export function charCountColor(len: number): string {
  if (len > WARRANTY_STORY_MAX_CHARS) return 'text-benz-red';
  if (len > WARRANTY_STORY_WARN_CHARS) return 'text-benz-amber';
  return 'text-benz-muted';
}

/** Reads the live warranty story textarea value, falling back to persisted line text. */
export function getWarrantyStoryTextareaValue(lineId: string, fallback?: string): string {
  const storyEl = document.getElementById(`warranty-story-${lineId}`) as HTMLTextAreaElement | null;
  return storyEl?.value ?? fallback ?? '';
}

export function readWarrantyStoryText(lineId: string, fallback?: string): string {
  return getWarrantyStoryTextareaValue(lineId, fallback).trim();
}