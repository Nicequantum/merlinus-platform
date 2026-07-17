const STORAGE_KEY = 'benz-tech-recent-templates';
const MAX_RECENT = 8;

export interface RecentTemplateRef {
  id: string;
  title: string;
  category: string;
  usedAt: string;
}

export function getRecentTemplateRefs(): RecentTemplateRef[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentTemplateRef[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRecentTemplate(ref: Omit<RecentTemplateRef, 'usedAt'>): RecentTemplateRef[] {
  if (typeof window === 'undefined') return [];
  const entry: RecentTemplateRef = { ...ref, usedAt: new Date().toISOString() };
  const next = [entry, ...getRecentTemplateRefs().filter((r) => r.id !== ref.id)].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearRecentTemplates(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}