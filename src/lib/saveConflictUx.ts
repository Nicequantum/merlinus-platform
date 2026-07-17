/**
 * Interactive 409 conflict resolution for repair-order saves.
 * Uses sonner action buttons so techs choose keep-local vs use-server.
 */

import { toast } from 'sonner';

export type SaveConflictChoice = 'keep-local' | 'use-server';

/**
 * Prompt the technician when optimistic concurrency fails.
 * Resolves once they pick an action; auto-dismiss does not resolve (caller should timeout).
 */
export function promptSaveConflictChoice(options?: {
  timeoutMs?: number;
}): Promise<SaveConflictChoice> {
  const timeoutMs = options?.timeoutMs ?? 30_000;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (choice: SaveConflictChoice) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      toast.dismiss(toastId);
      resolve(choice);
    };

    const toastId = toast.error('Save conflict — another change landed first', {
      description: 'Keep your edits on this device, or load the server version.',
      duration: timeoutMs,
      action: {
        label: 'Keep mine',
        onClick: () => finish('keep-local'),
      },
      cancel: {
        label: 'Use server',
        onClick: () => finish('use-server'),
      },
    });

    const timer = setTimeout(() => {
      // Default to keep-local so shop work is not discarded on timeout
      finish('keep-local');
    }, timeoutMs);
  });
}
