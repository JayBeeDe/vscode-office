import {accessLocalStorage} from "./compatibility";

// Nothing is remembered between two openings: a file opens at its top, the caret at its start, the
// outline expanded. The scroll position, the caret and the collapsed outline headings live in memory
// only, for the editor's lifetime (mode switch, window refocus, outline re-render). Keys older
// versions left in localStorage are removed once: `<cacheId>-scroll`, `<cacheId>-focus`,
// `vditor-outline-state:<cacheId>`, `vditor-global-settings`, and earlier still `md-…-focus` / `scrollTop_…`.
const LEGACY_FOCUS_KEY_PATTERN = /-focus$/;
const LEGACY_SCROLL_KEY_PATTERN = /^scrollTop_|-scroll$/;
const LEGACY_OUTLINE_KEY_PATTERN = /^vditor-outline-state:/;
// the shared settings older versions kept: whether the outline was shown, its width, the HTML
// editor's line wrap; none is remembered any more
const LEGACY_GLOBAL_SETTINGS_KEY = "vditor-global-settings";

let legacyDocumentStatePurged = false;
let scrollFocusAnchorHandler: ((vditor: IVditor) => void) | undefined;

type ScrollSession = {
    scrollTop: number;
    scrollSaveTimer: number;
    restoring: boolean;
    scrollBound: boolean;
};

const scrollSessions = new WeakMap<IVditor, ScrollSession>();

const createScrollSession = (): ScrollSession => ({
    scrollTop: 0,
    scrollSaveTimer: 0,
    restoring: false,
    scrollBound: false,
});

const getScrollSession = (vditor: IVditor): ScrollSession => {
    let session = scrollSessions.get(vditor);
    if (!session) {
        session = createScrollSession();
        scrollSessions.set(vditor, session);
    }
    return session;
};

export const setScrollFocusAnchorHandler = (handler: (vditor: IVditor) => void) => {
    scrollFocusAnchorHandler = handler;
};

export const purgeLegacyDocumentStateKeys = () => {
    if (legacyDocumentStatePurged || !accessLocalStorage()) {
        return;
    }
    legacyDocumentStatePurged = true;
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) {
            continue;
        }
        if (LEGACY_FOCUS_KEY_PATTERN.test(key) || LEGACY_SCROLL_KEY_PATTERN.test(key)
            || LEGACY_OUTLINE_KEY_PATTERN.test(key) || key === LEGACY_GLOBAL_SETTINGS_KEY) {
            localStorage.removeItem(key);
        }
    }
};

const getEditorElement = (vditor: IVditor): HTMLElement | null => {
    const mode = vditor.currentMode;
    if (mode === "ir" || mode === "wysiwyg") {
        return vditor[mode].element;
    }
    return null;
};

/** The scroll position kept in memory for this editor: 0, the top, for a file just opened */
const readStoredDocumentScroll = (vditor: IVditor): number => getScrollSession(vditor).scrollTop;

const persistScroll = (vditor: IVditor) => {
    const editorEl = getEditorElement(vditor);
    if (!editorEl) {
        return;
    }
    const session = getScrollSession(vditor);
    const top = editorEl.scrollTop;
    session.scrollTop = top;
    window.clearTimeout(session.scrollSaveTimer);
    scrollFocusAnchorHandler?.(vditor);
};

const schedulePersistScroll = (vditor: IVditor) => {
    const session = getScrollSession(vditor);
    window.clearTimeout(session.scrollSaveTimer);
    session.scrollSaveTimer = window.setTimeout(() => {
        persistScroll(vditor);
    }, 200);
};

const applyEditorScroll = (vditor: IVditor, top: number): boolean => {
    const editorEl = getEditorElement(vditor);
    if (!editorEl || Number.isNaN(top)) {
        return false;
    }
    const session = getScrollSession(vditor);
    session.restoring = true;
    editorEl.scrollTop = top;
    session.scrollTop = top;
    window.requestAnimationFrame(() => {
        session.restoring = false;
    });
    return true;
};

export const adjustEditorScrollBy = (vditor: IVditor, delta: number) => {
    const editorEl = getEditorElement(vditor);
    if (!editorEl || Number.isNaN(delta)) {
        return;
    }
    applyEditorScroll(vditor, editorEl.scrollTop + delta);
};

const onEditorScroll = (vditor: IVditor, event: Event) => {
    const session = getScrollSession(vditor);
    if (session.restoring) {
        return;
    }
    const editorEl = event.currentTarget as HTMLElement;
    const activeEl = getEditorElement(vditor);
    if (editorEl !== activeEl) {
        return;
    }
    session.scrollTop = editorEl.scrollTop;
    schedulePersistScroll(vditor);
};

const bindEditorScrollListeners = (vditor: IVditor) => {
    const session = getScrollSession(vditor);
    if (session.scrollBound) {
        return;
    }
    const selectors = [".vditor-wysiwyg .vditor-reset", ".vditor-ir .vditor-reset"];
    for (let i = 0; i < selectors.length; i++) {
        const editorEl = vditor.element.querySelector(selectors[i]) as HTMLElement | null;
        if (editorEl) {
            editorEl.addEventListener("scroll", (event) => {
                onEditorScroll(vditor, event);
            }, {passive: true});
        }
    }
    session.scrollBound = true;
};

export const bindDocumentScrollPersistence = (vditor: IVditor) => {
    bindEditorScrollListeners(vditor);

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            persistScroll(vditor);
        }
    });

    window.addEventListener("blur", () => {
        persistScroll(vditor);
    });
};

export const restoreDocumentScroll = (vditor: IVditor, scrollTop?: number) => {
    const editorEl = getEditorElement(vditor);
    if (!editorEl) {
        return;
    }
    const top = scrollTop != null ? Number(scrollTop) : readStoredDocumentScroll(vditor);
    if (Number.isNaN(top)) {
        return;
    }
    applyEditorScroll(vditor, top);
};
