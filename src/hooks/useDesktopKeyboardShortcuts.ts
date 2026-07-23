'use client';

import { useEffect } from 'react';

export type DesktopShortcutHandlers = {
  onSearchFocus?: () => void;
  onGenerateStory?: () => void;
  onGoHome?: () => void;
  onCopyStory?: () => void;
  onToggleActivity?: () => void;
  enabled?: boolean;
};

/**
 * Desktop power-user shortcuts (ignored while typing in inputs).
 * Ctrl/Cmd+K search · Ctrl/Cmd+Enter generate · Ctrl/Cmd+H home · Ctrl/Cmd+Shift+C copy
 */
export function useDesktopKeyboardShortcuts(handlers: DesktopShortcutHandlers) {
  useEffect(() => {
    if (handlers.enabled === false) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editing =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      // Allow Ctrl+Enter inside textareas for generate
      if (e.key === 'Enter' && mod) {
        if (editing && tag !== 'textarea' && tag !== 'input') return;
        e.preventDefault();
        handlers.onGenerateStory?.();
        return;
      }

      if (editing) return;

      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlers.onSearchFocus?.();
        return;
      }
      if (e.key.toLowerCase() === 'h') {
        e.preventDefault();
        handlers.onGoHome?.();
        return;
      }
      if (e.key.toLowerCase() === 'c' && e.shiftKey) {
        e.preventDefault();
        handlers.onCopyStory?.();
        return;
      }
      if (e.key.toLowerCase() === 'b' && e.shiftKey) {
        e.preventDefault();
        handlers.onToggleActivity?.();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}
