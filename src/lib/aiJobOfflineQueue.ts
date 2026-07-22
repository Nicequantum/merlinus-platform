/**
 * Lightweight offline intent queue for AI story jobs.
 * When the bay tablet is offline, store generate intent and retry on online.
 */
const STORAGE_KEY = 'merlinus.aiJob.intent.v1';

export interface AiStoryJobIntent {
  id: string;
  roId: string;
  lineId: string;
  technicianNotes?: string;
  warrantyStory?: string;
  createdAt: number;
  attempts: number;
}

function readAll(): AiStoryJobIntent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AiStoryJobIntent[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: AiStoryJobIntent[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-20)));
  } catch {
    // quota
  }
}

export function enqueueAiStoryJobIntent(
  input: Omit<AiStoryJobIntent, 'id' | 'createdAt' | 'attempts'>
): AiStoryJobIntent {
  const row: AiStoryJobIntent = {
    ...input,
    id: `aij_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    attempts: 0,
  };
  const all = readAll().filter(
    (x) => !(x.roId === row.roId && x.lineId === row.lineId)
  );
  all.push(row);
  writeAll(all);
  return row;
}

export function listAiStoryJobIntents(): AiStoryJobIntent[] {
  return readAll().sort((a, b) => a.createdAt - b.createdAt);
}

export function removeAiStoryJobIntent(id: string): void {
  writeAll(readAll().filter((x) => x.id !== id));
}

export async function flushAiStoryJobIntents(
  runOne: (intent: AiStoryJobIntent) => Promise<void>
): Promise<{ flushed: number; failed: number }> {
  // Treat missing navigator (tests / SSR) as online.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { flushed: 0, failed: 0 };
  }
  let flushed = 0;
  let failed = 0;
  const pending = listAiStoryJobIntents();
  for (const intent of pending) {
    try {
      await runOne(intent);
      removeAiStoryJobIntent(intent.id);
      flushed += 1;
    } catch {
      failed += 1;
      const all = readAll().map((x) =>
        x.id === intent.id ? { ...x, attempts: x.attempts + 1 } : x
      );
      writeAll(all.filter((x) => x.attempts < 5));
    }
  }
  return { flushed, failed };
}
