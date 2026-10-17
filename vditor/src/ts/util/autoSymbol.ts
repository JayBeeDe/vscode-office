import { CM_BLOCK_CLASS, isInsideCodeBlockChrome, isInsideCodeMirror } from "../codeBlock/codeMirrorManager";

// Keep the original keyCode trigger logic: 219 ([/{), 57 ((/9)
const AUTO_PAIR_KEYCODES = new Set([219, 57]);

/**
 * After a keyCode match, also check event.key, so IME / Chinese full-width punctuation does not trigger it.
 * - ( : keyCode 57 + Shift and event.key === '('
 * - [ : keyCode 219 + no Shift and event.key === '[' (excludes {)
 */
const resolveKeyCodePairClose = (event: KeyboardEvent): string | null => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
        return null;
    }
    if (!AUTO_PAIR_KEYCODES.has(event.keyCode)) {
        return null;
    }
    if (event.keyCode === 57 && event.shiftKey && event.key === "(") {
        return ")";
    }
    if (event.keyCode === 219 && !event.shiftKey && event.key === "[") {
        return "]";
    }
    return null;
};

const isInsideCodeBlockContext = (target: EventTarget | null) => {
    if (isInsideCodeMirror(target) || isInsideCodeBlockChrome(target)) {
        return true;
    }
    const node = target instanceof Element ? target : (target as Node | null)?.parentElement;
    if (!node) {
        return false;
    }
    return !!node.closest(`[data-type='code-block'], .${CM_BLOCK_CLASS}`);
};

/** Auto-close parentheses and square brackets; not active inside code blocks */
export const handleAutoSymbolPair = (event: KeyboardEvent) => {
    const close = resolveKeyCodePairClose(event);
    if (!close) {
        return;
    }
    if (isInsideCodeBlockContext(event.target) || isInsideCodeBlockContext(document.activeElement)) {
        return;
    }
    const selection = document.getSelection();
    if (!selection || selection.toString() !== "") {
        return;
    }
    document.execCommand("insertText", false, close);
    selection.modify("move", "left", "character");
};
