import { getCodeMirrorView, isInsideCodeBlockChrome, isInsideCodeMirror, restoreCodeMirrorFocus } from "../codeBlock/codeMirrorManager";
import { syncOutlineOnDocumentLoad } from "../outline/updateOutlineActive";
import { adjustEditorScrollBy, restoreDocumentScroll } from "./documentState";
import {
    getEditorRange,
    getEditorTextOffset,
    getNodePath,
    getRangeCaretRect,
    getSelectionRangeInEditor,
    setSelectionByPath,
    setSelectionByPosition,
} from "./selection";

type CacheFocusState = {
    mode: string;
    type: "editor" | "cm";
    start: number;
    end: number;
    startOffset?: number;
    endOffset?: number;
    startPath?: number[];
    endPath?: number[];
    scrollTop?: number;
    blockIndex?: number;
    /** Distance from the caret to the top of the editor viewport; recorded only if the caret is visible when scrolling */
    caretViewportOffset?: number;
};

type RestoreFocusOptions = {
    /** Restore on first page/document load (reads the persisted focus, regardless of whether focus was lost in this session) */
    onLoad?: boolean;
    /** Whether to restore the caret and focus; default true. When false, scrolling is still restored */
    restoreCaret?: boolean;
};

type CaretViewportMetrics = {
    offset: number;
    visible: boolean;
};

const sessionFocusMap = new WeakMap<IVditor, CacheFocusState>();
const focusSavedMap = new WeakMap<IVditor, boolean>();

const isVscodeFocusHost = (vditor: IVditor) => {
    return vditor.options.cache?.focusHost === "vscode";
};

const getCodeBlockIndex = (editor: HTMLElement, block: HTMLElement) => {
    const blocks = editor.querySelectorAll("[data-type='code-block']");
    let blockIndex = -1;
    let index = 0;
    for (const element of blocks) {
        if (element === block) {
            blockIndex = index;
            break;
        }
        index++;
    }
    return blockIndex;
};

// the caret is kept in memory only, for the editor's lifetime (documentState.ts)
const persistFocusState = (vditor: IVditor, state: CacheFocusState) => {
    sessionFocusMap.set(vditor, state);
    focusSavedMap.set(vditor, true);
};

const readFocusState = (vditor: IVditor): CacheFocusState | null => sessionFocusMap.get(vditor) ?? null;

/** A file just opened: the caret at the start of the document, which shows its top */
const placeCaretAtDocumentStart = (vditor: IVditor) => {
    const editor = vditor[vditor.currentMode]?.element as HTMLElement | undefined;
    if (!editor) {
        return;
    }
    setSelectionByPosition(0, 0, editor);
    editor.focus({ preventScroll: true });
};

const rectToCaretViewportMetrics = (editor: HTMLElement, top: number, bottom: number): CaretViewportMetrics => {
    const editorRect = editor.getBoundingClientRect();
    const visible = bottom > editorRect.top && top < editorRect.bottom;
    return {
        visible,
        offset: top - editorRect.top,
    };
};

const getCodeMirrorCaretViewportMetrics = (editor: HTMLElement, block: HTMLElement): CaretViewportMetrics | null => {
    const view = getCodeMirrorView(block);
    if (!view) {
        return null;
    }
    const pos = view.state.selection.main.head;
    const coords = view.coordsAtPos(pos, 1);
    if (!coords) {
        return null;
    }
    return rectToCaretViewportMetrics(editor, coords.top, coords.bottom);
};

const getActiveCaretViewportMetrics = (vditor: IVditor, editor: HTMLElement): CaretViewportMetrics | null => {
    const activeElement = document.activeElement;
    if (isInsideCodeMirror(activeElement)) {
        const block = activeElement?.closest("[data-type='code-block']") as HTMLElement | null;
        if (block && editor.contains(block)) {
            return getCodeMirrorCaretViewportMetrics(editor, block);
        }
    }

    const range = getSelectionRangeInEditor(editor);
    if (!range) {
        return null;
    }
    const caretRect = getRangeCaretRect(range);
    if (!caretRect) {
        return null;
    }
    return rectToCaretViewportMetrics(editor, caretRect.top, caretRect.bottom);
};

const getCaretViewportMetricsAfterRestore = (vditor: IVditor, state: CacheFocusState): CaretViewportMetrics | null => {
    const editor = vditor[vditor.currentMode].element;

    if (state.type === "cm" && state.blockIndex != null && state.blockIndex >= 0) {
        const blocks = editor.querySelectorAll("[data-type='code-block']");
        const block = blocks[state.blockIndex] as HTMLElement | undefined;
        if (block) {
            return getCodeMirrorCaretViewportMetrics(editor, block);
        }
        return null;
    }

    const range = getSelectionRangeInEditor(editor);
    if (!range) {
        return null;
    }
    const caretRect = getRangeCaretRect(range);
    if (!caretRect) {
        return null;
    }
    return rectToCaretViewportMetrics(editor, caretRect.top, caretRect.bottom);
};

const attachCaretViewportOffset = (vditor: IVditor, editor: HTMLElement, state: CacheFocusState): CacheFocusState => {
    const metrics = getActiveCaretViewportMetrics(vditor, editor);
    if (metrics?.visible) {
        return { ...state, caretViewportOffset: metrics.offset };
    }
    const next = { ...state };
    delete next.caretViewportOffset;
    return next;
};

const finalizeFocusState = (vditor: IVditor, state: CacheFocusState): CacheFocusState => {
    const editor = vditor[vditor.currentMode].element;
    let next = attachCaretViewportOffset(vditor, editor, state);
    if (isVscodeFocusHost(vditor)) {
        delete next.scrollTop;
    } else {
        next = { ...next, scrollTop: editor.scrollTop };
    }
    return next;
};

const buildFocusStateFromCurrentSelection = (vditor: IVditor): CacheFocusState | null => {
    const editor = vditor[vditor.currentMode].element;
    const activeElement = document.activeElement;

    if (isInsideCodeMirror(activeElement)) {
        const block = activeElement?.closest("[data-type='code-block']") as HTMLElement | null;
        if (block) {
            const blockIndex = getCodeBlockIndex(editor, block);
            const view = getCodeMirrorView(block);
            if (view && blockIndex >= 0) {
                const selection = view.state.selection.main;
                return {
                    mode: vditor.currentMode,
                    type: "cm",
                    start: selection.anchor,
                    end: selection.head,
                    blockIndex,
                };
            }
        }
    }

    const range = getSelectionRangeInEditor(editor);
    if (!range) {
        return null;
    }
    const { start, end } = getEditorTextOffset(editor, range);
    return {
        mode: vditor.currentMode,
        type: "editor",
        start,
        end,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startPath: getNodePath(editor, range.startContainer),
        endPath: getNodePath(editor, range.endContainer),
    };
};

export const persistScrollFocusAnchor = (vditor: IVditor) => {
    if (!vditor.options.cache?.id) {
        return;
    }

    const editor = vditor[vditor.currentMode].element;
    const metrics = getActiveCaretViewportMetrics(vditor, editor);
    let state = buildFocusStateFromCurrentSelection(vditor) ?? readFocusState(vditor);
    if (!state || state.mode !== vditor.currentMode) {
        return;
    }

    if (metrics?.visible) {
        persistFocusState(vditor, { ...state, caretViewportOffset: metrics.offset });
        return;
    }

    const nextState = { ...state };
    delete nextState.caretViewportOffset;
    persistFocusState(vditor, nextState);
};

const applyCaretViewportOffset = (vditor: IVditor, state: CacheFocusState): boolean => {
    if (state.caretViewportOffset == null || Number.isNaN(state.caretViewportOffset)) {
        return false;
    }
    const metrics = getCaretViewportMetricsAfterRestore(vditor, state);
    if (!metrics) {
        return false;
    }
    const delta = metrics.offset - state.caretViewportOffset;
    if (Math.abs(delta) < 1) {
        return true;
    }
    adjustEditorScrollBy(vditor, delta);
    return true;
};

const restoreDocumentScrollOnLoad = (vditor: IVditor, state: CacheFocusState) => {
    if (isVscodeFocusHost(vditor)) {
        restoreDocumentScroll(vditor);
        return;
    }
    if (state.scrollTop != null && !Number.isNaN(state.scrollTop)) {
        restoreDocumentScroll(vditor, state.scrollTop);
    }
};

const isEditorFocused = (vditor: IVditor) => {
    const editor = vditor[vditor.currentMode].element;
    const activeElement = document.activeElement;
    if (!activeElement) {
        return false;
    }
    return editor.contains(activeElement)
        || isInsideCodeMirror(activeElement)
        || isInsideCodeBlockChrome(activeElement);
};

/** Do not grab editor focus back while a dialog/popup is open, otherwise it would close */
const hasOpenEditorOverlay = (vditor: IVditor) => {
    const root = vditor.element;
    if (document.querySelector(".vditor-confirm-overlay") || document.querySelector(".vditor-img-overlay")) {
        return true;
    }
    const findBar = root.querySelector<HTMLElement>(".vditor-find-bar");
    if (findBar && findBar.style.display !== "none") {
        return true;
    }
    if (vditor.hint?.element?.style.display === "block") {
        return true;
    }
    if (vditor.wysiwyg?.popover?.style.display === "block") {
        return true;
    }
    if (vditor.ir?.popover?.style.display === "block") {
        return true;
    }
    for (const panel of vditor.toolbar.element.querySelectorAll<HTMLElement>(".vditor-hint")) {
        if (panel.style.display === "block") {
            return true;
        }
    }
    if (root.querySelector(".vditor-cm-chrome__lang--open")) {
        return true;
    }
    return false;
};

const canRestoreFocus = (vditor: IVditor, onLoad: boolean) => {
    if (onLoad) {
        return true;
    }
    return focusSavedMap.get(vditor) === true;
};

const applyFocusState = (vditor: IVditor, state: CacheFocusState) => {
    const editor = vditor[vditor.currentMode].element;

    if (state.type === "cm" && state.blockIndex != null && state.blockIndex >= 0) {
        const blocks = editor.querySelectorAll("[data-type='code-block']");
        const block = blocks[state.blockIndex] as HTMLElement | undefined;
        if (block) {
            restoreCodeMirrorFocus(block, state.start, state.end, vditor);
        }
        return;
    }

    const start = Math.max(0, state.start);
    const caretOnly = state.start === state.end;
    const end = caretOnly ? start : Math.max(start, state.end);
    const restoredByPath = setSelectionByPath(
        editor,
        state.startPath,
        state.startOffset,
        caretOnly ? state.startPath : state.endPath,
        caretOnly ? state.startOffset : state.endOffset,
    );
    if (!restoredByPath) {
        setSelectionByPosition(start, end, editor);
    }
    editor.focus({ preventScroll: true });
};

const finishDocumentLoadScroll = (vditor: IVditor, state: CacheFocusState | null) => {
    if (state && applyCaretViewportOffset(vditor, state)) {
        return;
    }
    if (state) {
        restoreDocumentScrollOnLoad(vditor, state);
        return;
    }
    restoreDocumentScroll(vditor);
};

const scheduleOutlineSyncOnLoad = (vditor: IVditor) => {
    window.requestAnimationFrame(() => {
        syncOutlineOnDocumentLoad(vditor);
    });
};

export const saveCacheFocus = (vditor: IVditor) => {
    const editor = vditor[vditor.currentMode].element;
    const activeElement = document.activeElement;

    if (isInsideCodeMirror(activeElement)) {
        const block = activeElement?.closest("[data-type='code-block']") as HTMLElement | null;
        if (block) {
            const blockIndex = getCodeBlockIndex(editor, block);
            const view = getCodeMirrorView(block);
            if (view && blockIndex >= 0) {
                const selection = view.state.selection.main;
                persistFocusState(vditor, finalizeFocusState(vditor, {
                    mode: vditor.currentMode,
                    type: "cm",
                    start: selection.anchor,
                    end: selection.head,
                    blockIndex,
                }));
                return;
            }
        }
    }

    const range = getEditorRange(vditor);
    const { start, end } = getEditorTextOffset(editor, range);
    persistFocusState(vditor, finalizeFocusState(vditor, {
        mode: vditor.currentMode,
        type: "editor",
        start,
        end,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startPath: getNodePath(editor, range.startContainer),
        endPath: getNodePath(editor, range.endContainer),
    }));
};

export const restoreCacheFocus = (vditor: IVditor, options?: RestoreFocusOptions) => {
    const onLoad = options?.onLoad === true;
    const restoreCaret = options?.restoreCaret !== false;
    if (!canRestoreFocus(vditor, onLoad)) {
        return;
    }

    const state = readFocusState(vditor);
    if (!state || state.mode !== vditor.currentMode) {
        if (onLoad) {
            if (!state && restoreCaret) {
                placeCaretAtDocumentStart(vditor);
            }
            finishDocumentLoadScroll(vditor, null);
            scheduleOutlineSyncOnLoad(vditor);
        }
        return;
    }

    if (restoreCaret && (onLoad || focusSavedMap.get(vditor) === true)) {
        focusSavedMap.set(vditor, true);
    }

    const apply = () => {
        if (restoreCaret) {
            applyFocusState(vditor, state);
        }
        if (!onLoad) {
            return;
        }
        if (restoreCaret) {
            finishDocumentLoadScroll(vditor, state);
        } else {
            restoreDocumentScrollOnLoad(vditor, state);
        }
        scheduleOutlineSyncOnLoad(vditor);
    };

    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(apply);
    });
};

export const bindCacheFocusPersistence = (vditor: IVditor) => {
    if (!isVscodeFocusHost(vditor)) return;
    const persistFocus = () => saveCacheFocus(vditor);
    window.addEventListener("pagehide", persistFocus);
    window.addEventListener("blur", persistFocus);
    window.addEventListener("focus", () => {
        if (hasOpenEditorOverlay(vditor) || isEditorFocused(vditor)) {
            return;
        }
        restoreCacheFocus(vditor);
    });
};
