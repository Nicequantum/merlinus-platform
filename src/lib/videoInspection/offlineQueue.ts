/**
 * PR-M1b — IndexedDB offline queue for Video MPI uploads.
 * Client-only. Does not touch warranty RO story data.
 */

const DB_NAME = 'merlinus-video-mpi';
const DB_VERSION = 1;
const STORE = 'pendingUploads';

export interface PendingVideoUploadMeta {
  title?: string;
  vehicleLabel?: string;
  customerName?: string;
  customerPhone?: string;
  vin?: string;
  transcript?: string;
  transcriptLanguage?: string;
  recordingMode?: 'fullscreen' | 'standard' | 'upload';
  durationSec?: number;
  /** Optional link to a repair order in the same rooftop. */
  repairOrderId?: string;
  repairLineId?: string;
}

export interface PendingVideoUpload {
  id: string;
  createdAt: number;
  updatedAt: number;
  contentType: string;
  /** Base video blob */
  video: Blob;
  frames: Blob[];
  meta: PendingVideoUploadMeta;
  attempts: number;
  lastError?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

export async function enqueuePendingUpload(
  input: Omit<PendingVideoUpload, 'id' | 'createdAt' | 'updatedAt' | 'attempts'> & {
    id?: string;
  }
): Promise<PendingVideoUpload> {
  const now = Date.now();
  const row: PendingVideoUpload = {
    id: input.id || `pvu_${now}_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: now,
    updatedAt: now,
    contentType: input.contentType,
    video: input.video,
    frames: input.frames || [],
    meta: input.meta || {},
    attempts: 0,
    lastError: input.lastError,
  };
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).put(row));
    return row;
  } finally {
    db.close();
  }
}

export async function listPendingUploads(): Promise<PendingVideoUpload[]> {
  const db = await openDb();
  try {
    const rows = await idbReq(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll() as IDBRequest<PendingVideoUpload[]>
    );
    return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
  } finally {
    db.close();
  }
}

export async function getPendingUpload(id: string): Promise<PendingVideoUpload | null> {
  const db = await openDb();
  try {
    const row = await idbReq(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id) as IDBRequest<PendingVideoUpload | undefined>
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function updatePendingUpload(
  id: string,
  patch: Partial<Pick<PendingVideoUpload, 'attempts' | 'lastError' | 'updatedAt'>>
): Promise<void> {
  const existing = await getPendingUpload(id);
  if (!existing) return;
  const next: PendingVideoUpload = {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  };
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).put(next));
  } finally {
    db.close();
  }
}

export async function removePendingUpload(id: string): Promise<void> {
  const db = await openDb();
  try {
    await idbReq(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
  } finally {
    db.close();
  }
}

export async function countPendingUploads(): Promise<number> {
  const db = await openDb();
  try {
    return await idbReq(db.transaction(STORE, 'readonly').objectStore(STORE).count());
  } finally {
    db.close();
  }
}

/**
 * Flush pending Video MPI uploads when the tablet comes back online.
 * Caller provides the upload function (keeps this module free of API imports).
 */
export async function flushPendingUploadsWhenOnline(
  uploadOne: (item: PendingVideoUpload) => Promise<void>,
  options?: { maxItems?: number }
): Promise<{ flushed: number; failed: number }> {
  const maxItems = options?.maxItems ?? 5;
  let flushed = 0;
  let failed = 0;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { flushed: 0, failed: 0 };
  }
  const pending = await listPendingUploads();
  for (const item of pending.slice(0, maxItems)) {
    try {
      await uploadOne(item);
      await removePendingUpload(item.id);
      flushed += 1;
    } catch (error) {
      failed += 1;
      await updatePendingUpload(item.id, {
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message.slice(0, 200) : 'upload failed',
      });
    }
  }
  return { flushed, failed };
}

/** Register online listener to auto-flush; returns unsubscribe. */
export function startVideoOfflineFlushListener(
  uploadOne: (item: PendingVideoUpload) => Promise<void>
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => {
    void flushPendingUploadsWhenOnline(uploadOne).catch(() => undefined);
  };
  window.addEventListener('online', onOnline);
  // Also try once on start if already online
  if (navigator.onLine) {
    void flushPendingUploadsWhenOnline(uploadOne).catch(() => undefined);
  }
  return () => window.removeEventListener('online', onOnline);
}
