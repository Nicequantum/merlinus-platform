/**
 * Per-RO serialized saves so concurrent work on different ROs never blocks each other,
 * while same-RO PUTs/PATCHes still cannot race.
 */

type QueueEntry = {
  chain: Promise<unknown>;
  pending: number;
};

const queues = new Map<string, QueueEntry>();

function getQueue(roId: string): QueueEntry {
  let q = queues.get(roId);
  if (!q) {
    q = { chain: Promise.resolve(), pending: 0 };
    queues.set(roId, q);
  }
  return q;
}

function pruneIfIdle(roId: string, q: QueueEntry): void {
  if (q.pending <= 0) {
    queues.delete(roId);
  }
}

/**
 * @param roId Repair order id (or 'global' for create-before-id paths)
 */
export function enqueueRepairOrderSave<T>(roId: string, task: () => Promise<T>): Promise<T> {
  const key = roId || 'global';
  const q = getQueue(key);
  q.pending += 1;
  const next = q.chain.then(
    () => task(),
    () => task()
  );
  q.chain = next.then(
    () => {
      q.pending = Math.max(0, q.pending - 1);
      pruneIfIdle(key, q);
      return undefined;
    },
    () => {
      q.pending = Math.max(0, q.pending - 1);
      pruneIfIdle(key, q);
      return undefined;
    }
  );
  return next;
}

/** Wait for one RO (or all queues if roId omitted). */
export async function awaitRepairOrderSaveQueue(roId?: string): Promise<void> {
  if (roId) {
    const q = queues.get(roId);
    if (q) await q.chain;
    return;
  }
  await Promise.all([...queues.values()].map((q) => q.chain));
}

/** True while saves are queued/in-flight for a RO, or any RO if id omitted. */
export function isRepairOrderSaveQueueBusy(roId?: string): boolean {
  if (roId) {
    return (queues.get(roId)?.pending ?? 0) > 0;
  }
  for (const q of queues.values()) {
    if (q.pending > 0) return true;
  }
  return false;
}

/** Prevent story generation / navigation from blocking on a stuck PUT chain. */
export async function awaitRepairOrderSaveQueueWithTimeout(
  timeoutMs: number,
  roId?: string
): Promise<boolean> {
  try {
    await Promise.race([
      awaitRepairOrderSaveQueue(roId),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('repair order save queue timeout')), timeoutMs)
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
