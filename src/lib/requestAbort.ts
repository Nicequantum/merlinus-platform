/** True when a fetch or cooperative client task was aborted (user cancel or AbortSignal). */
export function isRequestAborted(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}