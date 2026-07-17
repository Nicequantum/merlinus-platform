'use client';

/** Open the device camera or gallery picker — input is mounted in DOM for mobile Safari reliability. */
export function openImageFilePicker(options: {
  capture?: boolean;
  multiple?: boolean;
  accept?: string;
  onFiles: (files: File[]) => void;
}): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = options.accept ?? 'image/*';
  if (options.capture) {
    input.capture = 'environment';
  }
  input.multiple = options.multiple ?? false;
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
  document.body.appendChild(input);

  let settled = false;
  let cancelTimer: number | undefined;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    if (cancelTimer !== undefined) window.clearTimeout(cancelTimer);
    window.removeEventListener('focus', onWindowFocus);
    document.removeEventListener('visibilitychange', onVisibility);
    // Defer remove so mobile browsers finish delivering the change event after focus.
    window.setTimeout(() => {
      try {
        input.remove();
      } catch {
        /* already detached */
      }
    }, 500);
  };

  const armCancelTimer = (ms: number) => {
    if (cancelTimer !== undefined) window.clearTimeout(cancelTimer);
    cancelTimer = window.setTimeout(cleanup, ms);
  };

  const onWindowFocus = () => {
    // Camera apps can return after long idle — give change event time to fire.
    armCancelTimer(30_000);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      armCancelTimer(30_000);
    }
  };

  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    // Copy File list before cleanup — some WebViews clear input.files on remove.
    const copied = files.slice();
    cleanup();
    if (copied.length > 0) {
      options.onFiles(copied);
    }
  });

  window.addEventListener('focus', onWindowFocus);
  document.addEventListener('visibilitychange', onVisibility);
  // Long camera sessions (first use / permission dialogs) need more than 2 minutes.
  armCancelTimer(300_000);
  input.click();
}
