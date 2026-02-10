'use client';

import { useEffect, useCallback } from 'react';

export interface KeyBinding {
  key: string;
  modifiers?: { shift?: boolean; meta?: boolean; ctrl?: boolean };
  handler: () => void;
  when?: () => boolean;
  preventDefault?: boolean; // Default true
}

export function useTriageKeyboard(
  bindings: KeyBinding[],
  enabled: boolean = true
) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't handle if focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }

      for (const binding of bindings) {
        if (e.key !== binding.key) continue;

        // Check modifiers (default false for each)
        const shift = binding.modifiers?.shift ?? false;
        const meta = binding.modifiers?.meta ?? false;
        const ctrl = binding.modifiers?.ctrl ?? false;

        if (e.shiftKey !== shift) continue;
        if (e.metaKey !== meta) continue;
        if (e.ctrlKey !== ctrl) continue;

        // Check when condition
        if (binding.when && !binding.when()) continue;

        // Match found
        if (binding.preventDefault !== false) e.preventDefault();
        binding.handler();
        return;
      }
    },
    [bindings, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
