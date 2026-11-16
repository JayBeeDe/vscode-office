import { useEffect } from 'react';

const isCompose = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;

/** Ctrl+Shift+Z: the redo alternative the libraries bind, Ctrl+Y stays the redo shortcut. */
export const isAlternativeRedo = (e: KeyboardEvent) =>
    isCompose(e) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z';

/**
 * Turns off shortcuts a viewer's library hard-codes: the keydown is caught on the window, in the
 * capture phase, before the library's own listeners, and dropped (the browser's own action too:
 * Ctrl+Shift+Z is its redo in an editable element). `isBlocked` must be stable (a module-level
 * function), or the listener is replaced at every render.
 */
export function useBlockedShortcuts(isBlocked: (e: KeyboardEvent) => boolean) {
    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if (!isBlocked(e)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        };
        window.addEventListener('keydown', listener, true);
        return () => window.removeEventListener('keydown', listener, true);
    }, [isBlocked]);
}
