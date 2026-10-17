import {highlightToolbarIR} from "../ir/highlightToolbarIR";
import {highlightToolbarWYSIWYG} from "../wysiwyg/highlightToolbarWYSIWYG";

/** Coalesce high-frequency events such as keyup into one toolbar state refresh on the next frame */
const HIGHLIGHT_TOOLBAR_DEBOUNCE_MS = 64;

export const highlightToolbar = (vditor: IVditor) => {
    if (vditor.currentMode === "wysiwyg") {
        highlightToolbarWYSIWYG(vditor);
    } else if (vditor.currentMode === "ir") {
        highlightToolbarIR(vditor);
    }
};

export const scheduleHighlightToolbar = (vditor: IVditor) => {
    if (vditor.currentMode !== "wysiwyg" && vditor.currentMode !== "ir") {
        return;
    }
    const modeState = vditor[vditor.currentMode];
    clearTimeout(modeState.hlToolbarTimeoutId);
    modeState.hlToolbarTimeoutId = window.setTimeout(() => {
        modeState.hlToolbarTimeoutId = 0;
        highlightToolbar(vditor);
    }, HIGHLIGHT_TOOLBAR_DEBOUNCE_MS);
};
