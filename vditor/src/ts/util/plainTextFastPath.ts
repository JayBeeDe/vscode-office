/**
 * Fast path for non-symbol insertText: skip wbr / SpinVditorDOM / outerHTML replacement.
 * Enabled only for documents that are long enough at first load; small files keep the original full spin behaviour.
 */

/** Enable the fast path at long technical article size (about 12,000 characters) */
export const PLAIN_TEXT_FAST_PATH_MIN_LENGTH = 12_000;

/** Characters that trigger Markdown structure or spin handling (including whitespace) */
const MARKDOWN_TRIGGER_RE = /[`*_~#\-+>\[\]()|!$\\=\s]/;

export const containsMarkdownTriggerChar = (text: string): boolean => {
    return MARKDOWN_TRIGGER_RE.test(text);
};

export const isPlainTextFastPathEnabled = (vditor: IVditor): boolean => {
    return (vditor.documentInitialLength ?? 0) >= PLAIN_TEXT_FAST_PATH_MIN_LENGTH;
};

export const canUsePlainTextFastPath = (vditor: IVditor, event: InputEvent): boolean => {
    if (!isPlainTextFastPathEnabled(vditor)) {
        return false;
    }
    if (event.isComposing) {
        return false;
    }
    if (event.inputType !== "insertText") {
        return false;
    }
    if (!event.data) {
        return false;
    }
    return !containsMarkdownTriggerChar(event.data);
};
