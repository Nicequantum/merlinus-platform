export function debounce<T extends (...args: never[]) => void | Promise<void>>(
  fn: T,
  ms: number
): T & { flush: () => Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let flushInFlight: Promise<void> | null = null;

  const debounced = ((...args: Parameters<T>) => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) {
        void Promise.resolve(fn(...lastArgs));
        lastArgs = null;
      }
    }, ms);
  }) as T & { flush: () => Promise<void>; cancel: () => void };

  // H2: awaitable flush so callers can serialize with other saves.
  debounced.flush = async () => {
    if (flushInFlight) {
      await flushInFlight;
      return;
    }
    if (timer && lastArgs) {
      clearTimeout(timer);
      timer = null;
      const args = lastArgs;
      lastArgs = null;
      flushInFlight = Promise.resolve(fn(...args)).finally(() => {
        flushInFlight = null;
      });
      await flushInFlight;
    }
  };

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  return debounced;
}