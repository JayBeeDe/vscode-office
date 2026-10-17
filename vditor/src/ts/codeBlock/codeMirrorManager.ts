import { indentLess, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { LanguageSupport } from "@codemirror/language";
import { Compartment, EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

import { expandMarker } from "../ir/expandMarker";
import { processAfterRender, recordHistory as recordIrHistory } from "../ir/process";
import { Constants } from "../constants";
import { recordHistory as recordWysiwygHistory } from "../wysiwyg/afterRenderEvent";
import {
    getEditorRange,
    preserveEditorScroll,
    scrollCaretIntoEditorView,
    scrollElementIntoEditorView,
    setRangeByWbr,
    setSelectionFocus,
} from "../util/selection";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";
import {
    ensureCodeBlockChrome,
    removeCodeBlockChrome,
    updateCodeBlockChromeLanguage,
} from "./codeBlockChrome";
import { loadCodeMirrorHighlightLanguage } from "./codeBlockHighlightLanguages";
import { resolveCodeMirrorCopyPayload } from "./codeMirrorRichCopy";
import { stopHandledCodeMirrorKeymap, vditorCodeMirrorSetup } from "./codeMirrorSetup";
import { mathRender } from "../markdown/mathRender";
import { mermaidRender } from "../markdown/mermaidRender";
import { plantumlRender } from "../markdown/plantumlRender";
import {
    deactivateInlineMathEditorsInScope,
    flushInlineMathToSyncCode,
} from "../math/inlineMathCodeMirror";
import {
    flushFrontMatterYamlToSyncCode,
} from "./frontMatterEditor";

export { focusCodeBlockChromeLanguage, isInsideCodeBlockChrome } from "./codeBlockChrome";

const CM_HOST_CLASS = "vditor-cm-host";
export const CM_BLOCK_CLASS = "vditor-code-block--cm";
export const CM_EDITING_CLASS = "vditor-cm-block--editing";
export const CM_SPLIT_CLASS = "vditor-cm-block--split";
const CM_BLOCK_DATA_TYPES = new Set(["code-block", "math-block"]);
const SPECIAL_LANGUAGES = ["mermaid", "plantuml", "math"];
/** Maximum number of CodeMirror instances mounted at once in the viewport (Milkdown reference: <15 CM instances for a 25-block document) */
const LAZY_CM_MAX_MOUNTED = 15;
/** Margin around the viewport, same as Milkdown */
const LAZY_CM_VIEWPORT_MARGIN = 200;
/** Delay unmounting CodeMirror after it scrolls out of view, to avoid repeated create/destroy while scrolling fast */
const LAZY_CM_TEARDOWN_DELAY = 5000;
const CM_PLACEHOLDER_CLASS = "vditor-code-block-placeholder";

let lazyCodeMirrorObserver: IntersectionObserver | null = null;
const lazyVisibilityCallbacks = new WeakMap<HTMLElement, (isIntersecting: boolean) => void>();
const lazyTeardownTimers = new WeakMap<HTMLElement, number>();
const lazyPendingTeardownBlocks = new Set<HTMLElement>();

interface CodeMirrorBinding {
    view: EditorView;
    languageCompartment: Compartment;
    editPre: HTMLElement;
    syncCode: HTMLElement;
    updating: boolean;
    syncTimer: number;
    previewTimer: number;
    languageName: string;
}

const bindings = new WeakMap<HTMLElement, CodeMirrorBinding>();

export const isSpecialCodeLanguage = (codeElement: HTMLElement) => {
    for (const lang of SPECIAL_LANGUAGES) {
        if (codeElement.classList.contains(`language-${lang}`)) {
            return true;
        }
    }
    return false;
};

/** The PlantUML preview renders as an img inside code and must not open the regular image edit popup */
export const isPlantumlRenderImage = (target: EventTarget | null) => {
    return target instanceof HTMLElement
        && target.tagName === "IMG"
        && !!target.closest(".language-plantuml");
};

export const isSpecialBlock = (blockElement: HTMLElement | null) => {
    if (!blockElement) {
        return false;
    }
    if (blockElement.getAttribute("data-type") === "math-block") {
        return true;
    }
    const parts = getBlockParts(blockElement);
    return !!parts && isSpecialCodeLanguage(parts.code);
};

export const isSpecialPreviewBlock = (blockElement: HTMLElement | null) => {
    return isSpecialBlock(blockElement) && !blockElement?.classList.contains(CM_EDITING_CLASS);
};

export const isMathBlockElement = (blockElement: HTMLElement | null) => {
    return blockElement?.getAttribute("data-type") === "math-block";
};

/** Math block preview state: hide the source pre and show only the rendered result (the source is kept only for Lute / CodeMirror sync) */
export const ensureMathBlockPreviewMode = (blockElement: HTMLElement) => {
    if (!isMathBlockElement(blockElement) || blockElement.classList.contains(CM_EDITING_CLASS)) {
        return;
    }
    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    parts.editPre.style.display = "none";
    parts.editPre.setAttribute("contenteditable", "false");
    parts.code.classList.add("language-math");
    parts.code.setAttribute("contenteditable", "false");
    if (parts.preview) {
        parts.preview.style.display = "";
    }
};

export const syncMathBlocksPreviewMode = (root: ParentNode) => {
    for (const block of root.querySelectorAll("[data-type='math-block']")) {
        ensureMathBlockPreviewMode(block as HTMLElement);
    }
};

const getMathBlockText = (blockElement: HTMLElement) => {
    const binding = bindings.get(blockElement);
    if (binding) {
        return binding.view.state.doc.toString();
    }
    const parts = getBlockParts(blockElement);
    return parts?.code.textContent ?? "";
};

export const isMathBlockEmpty = (blockElement: HTMLElement) => {
    return getMathBlockText(blockElement).trim() === "";
};

/** Empty math blocks default to CodeMirror; non-empty blocks stay in preview until edited */
export const syncMathBlockDisplayMode = (vditor: IVditor, blockElement: HTMLElement, focus = false) => {
    const block = normalizeCmBlockElement(blockElement, getModeEditor(vditor)) || blockElement;
    if (!isMathBlockElement(block)) {
        return;
    }
    if (isMathBlockEmpty(block)) {
        if (!block.classList.contains(CM_EDITING_CLASS)) {
            enterSpecialBlockEdit(vditor, block, focus);
        } else if (focus) {
            focusCodeMirror(block, true, vditor);
        }
        return;
    }
    if (block.classList.contains(CM_EDITING_CLASS)) {
        return;
    }
    ensureMathBlockPreviewMode(block);
};

export const syncMathBlocksDisplayMode = (root: ParentNode, vditor: IVditor) => {
    for (const block of root.querySelectorAll("[data-type='math-block']")) {
        syncMathBlockDisplayMode(vditor, block as HTMLElement);
    }
};

/** After IR expands the marker: enter CodeMirror automatically when the caret lands on an empty math block */
export const syncIrMathBlockAfterExpand = (vditor: IVditor, range: Range) => {
    if (vditor.currentMode !== "ir") {
        return;
    }
    const blockElement = getCmBlockFromNode(range.startContainer, vditor.ir.element);
    if (blockElement && isMathBlockElement(blockElement)) {
        syncMathBlockDisplayMode(vditor, blockElement, true);
    }
};

export const isCmCodeBlock = (blockElement: HTMLElement | null) => {
    if (!blockElement) {
        return false;
    }
    const dataType = blockElement.getAttribute("data-type");
    if (!dataType || !CM_BLOCK_DATA_TYPES.has(dataType)) {
        return false;
    }
    if (!getBlockParts(blockElement)) {
        return false;
    }
    if (isSpecialBlock(blockElement)) {
        return blockElement.classList.contains(CM_EDITING_CLASS);
    }
    return true;
};

/** @deprecated use isCmCodeBlock */
export const isWysiwygCmCodeBlock = isCmCodeBlock;

const isInsideAnyCodeMirrorEditor = (node: Element | null) =>
    !!node?.closest(`.${CM_BLOCK_CLASS} .cm-editor, .vditor-math-inline--editing .cm-editor`);

export const isInsideCodeMirror = (target: EventTarget | Node | null) => {
    if (!target) {
        return isInsideAnyCodeMirrorEditor(document.activeElement);
    }
    const node = target instanceof Element ? target : (target as Node).parentElement;
    return isInsideAnyCodeMirrorEditor(node);
};

/** @deprecated use isInsideCodeMirror */
export const isInsideWysiwygCodeMirror = isInsideCodeMirror;

export const getCodeLanguageName = (codeElement: HTMLElement) => {
    const match = codeElement.className.match(/language-([^\s]+)/);
    return match ? match[1] : "";
};

/** @deprecated use getCodeLanguageName */
const getLanguageName = getCodeLanguageName;

export const shouldShowLanguagePopover = (blockElement: HTMLElement | null) => {
    if (!blockElement || blockElement.getAttribute("data-type") !== "code-block") {
        return false;
    }
    return hasCodeMirror(blockElement) || isCmCodeBlock(blockElement);
};

export const resolveCmCodeBlock = (vditor: IVditor, blockElement?: HTMLElement | null) => {
    if (blockElement?.isConnected && shouldShowLanguagePopover(blockElement)) {
        return blockElement;
    }
    const fromActive = document.activeElement?.closest("[data-type='code-block']") as HTMLElement;
    if (fromActive?.isConnected && shouldShowLanguagePopover(fromActive)) {
        return fromActive;
    }
    const editor = getModeEditor(vditor);
    if (editor) {
        const focusedCm = editor.querySelector(`.${CM_BLOCK_CLASS} .cm-editor.cm-focused`);
        const fromCm = focusedCm?.closest("[data-type='code-block']") as HTMLElement;
        if (fromCm?.isConnected && shouldShowLanguagePopover(fromCm)) {
            return fromCm;
        }
    }
    return blockElement?.isConnected ? blockElement : null;
};

const getBlockParts = (blockElement: HTMLElement) => {
    const editPre = blockElement.querySelector(
        "pre.vditor-wysiwyg__pre, pre.vditor-ir__marker--pre, pre:first-child",
    ) as HTMLElement;
    if (!editPre) {
        return null;
    }
    const code = editPre.querySelector("code");
    if (!code) {
        return null;
    }
    const preview = blockElement.querySelector(
        ".vditor-wysiwyg__preview, .vditor-ir__preview",
    ) as HTMLElement;
    return { editPre, code, preview };
};

const getModeEditor = (vditor: IVditor) => {
    if (vditor.currentMode === "wysiwyg") {
        return vditor.wysiwyg.element;
    }
    if (vditor.currentMode === "ir") {
        return vditor.ir.element;
    }
    return null;
};

const getCmBlockSelector = (mode: string) => {
    if (mode === "wysiwyg") {
        return ".vditor-wysiwyg__block[data-type='code-block'], .vditor-wysiwyg__block[data-type='math-block']";
    }
    return "[data-type='code-block'], [data-type='math-block']";
};

/** @deprecated use getCmBlockSelector */
const getCodeBlockSelector = getCmBlockSelector;

const isBlockNearViewport = (blockElement: HTMLElement, margin = LAZY_CM_VIEWPORT_MARGIN) => {
    const rect = blockElement.getBoundingClientRect();
    return rect.bottom >= -margin && rect.top <= window.innerHeight + margin;
};

/** Only regular code blocks are lazy-loaded by viewport; math / mermaid / plantuml are not affected */
const isLazyManagedCodeBlock = (blockElement: HTMLElement) =>
    !isSpecialBlock(blockElement);

/** Preview rendering of special code blocks (mermaid etc.) in the viewport */
export const ensureSpecialCodeBlockPreview = (blockElement: HTMLElement, vditor: IVditor) => {
    if (bindings.has(blockElement)) {
        return;
    }
    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    if (!isSpecialBlock(blockElement) || blockElement.classList.contains(CM_EDITING_CLASS)) {
        return;
    }
    if (parts.preview && parts.preview.getAttribute("data-render") !== "1") {
        rerenderSpecialPreview(parts.preview, vditor, parts.code.textContent || "");
    }
};

/** Off-screen regular code blocks: plain text placeholder, no CM / hljs cost */
const showPlainCodeBlockPlaceholder = (blockElement: HTMLElement) => {
    if (!isLazyManagedCodeBlock(blockElement)) {
        return;
    }
    blockElement.classList.remove(CM_BLOCK_CLASS, CM_EDITING_CLASS, CM_SPLIT_CLASS);
    blockElement.classList.add(CM_PLACEHOLDER_CLASS);
    removeCodeBlockChrome(blockElement);
    blockElement.querySelectorAll(".cm-editor, .vditor-cm-chrome").forEach((el) => {
        el.remove();
    });
    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    parts.editPre.classList.remove(CM_HOST_CLASS);
    parts.editPre.classList.add(CM_PLACEHOLDER_CLASS);
    parts.editPre.removeAttribute("contenteditable");
    parts.editPre.style.display = "block";
    parts.code.removeAttribute("hidden");
    parts.code.removeAttribute("aria-hidden");
    parts.code.style.display = "";
    if (parts.preview) {
        parts.preview.style.display = "none";
    }
    if (isMathBlockElement(blockElement)) {
        ensureMathBlockPreviewMode(blockElement);
    }
};

const cancelLazyTeardown = (blockElement: HTMLElement) => {
    const timer = lazyTeardownTimers.get(blockElement);
    if (timer !== undefined) {
        window.clearTimeout(timer);
        lazyTeardownTimers.delete(blockElement);
    }
    lazyPendingTeardownBlocks.delete(blockElement);
};

const canTeardownLazyCodeMirror = (blockElement: HTMLElement) => {
    const binding = bindings.get(blockElement);
    if (!binding) {
        return false;
    }
    if (binding.view.hasFocus) {
        return false;
    }
    if (blockElement.contains(document.activeElement)) {
        return false;
    }
    return true;
};

const scheduleLazyTeardown = (blockElement: HTMLElement) => {
    if (!bindings.has(blockElement)) {
        return;
    }
    cancelLazyTeardown(blockElement);
    lazyPendingTeardownBlocks.add(blockElement);
    const timer = window.setTimeout(() => {
        lazyTeardownTimers.delete(blockElement);
        lazyPendingTeardownBlocks.delete(blockElement);
        if (!canTeardownLazyCodeMirror(blockElement)) {
            return;
        }
        destroyCodeMirror(blockElement);
        showPlainCodeBlockPlaceholder(blockElement);
    }, LAZY_CM_TEARDOWN_DELAY);
    lazyTeardownTimers.set(blockElement, timer);
};

const handleLazyCodeBlockVisibility = (
    vditor: IVditor,
    blockElement: HTMLElement,
    isIntersecting: boolean,
) => {
    if (!isLazyManagedCodeBlock(blockElement)) {
        return;
    }
    if (isIntersecting) {
        cancelLazyTeardown(blockElement);
        blockElement.classList.remove(CM_PLACEHOLDER_CLASS);
        if (!bindings.has(blockElement)) {
            enforceMaxMounted(vditor, blockElement);
            mountCodeMirror(blockElement, vditor, true);
        }
        return;
    }
    if (bindings.has(blockElement)) {
        scheduleLazyTeardown(blockElement);
    }
};

const registerLazyCodeBlockVisibility = (vditor: IVditor, blockElement: HTMLElement) => {
    if (!isLazyManagedCodeBlock(blockElement)) {
        return;
    }
    setupLazyCodeMirrorObserver(vditor);
    lazyVisibilityCallbacks.set(blockElement, (isIntersecting) => {
        handleLazyCodeBlockVisibility(vditor, blockElement, isIntersecting);
    });
    lazyCodeMirrorObserver?.observe(blockElement);
};

const destroyCodeMirror = (blockElement: HTMLElement) => {
    cancelLazyTeardown(blockElement);
    const binding = bindings.get(blockElement);
    if (!binding) {
        return;
    }
    window.clearTimeout(binding.syncTimer);
    window.clearTimeout(binding.previewTimer);
    binding.syncCode.textContent = binding.view.state.doc.toString();
    binding.view.destroy();
    bindings.delete(blockElement);
    binding.editPre.querySelector(".cm-editor")?.remove();
    const wasSpecialEdit = blockElement.classList.contains(CM_EDITING_CLASS);
    if (wasSpecialEdit) {
        removeCodeBlockChrome(blockElement);
        blockElement.classList.remove(CM_BLOCK_CLASS, CM_EDITING_CLASS, CM_SPLIT_CLASS);
    } else if (isLazyManagedCodeBlock(blockElement)) {
        showPlainCodeBlockPlaceholder(blockElement);
    }
};

const getMountedCodeBlocks = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return [] as HTMLElement[];
    }
    const mounted: HTMLElement[] = [];
    for (const block of editor.querySelectorAll(getCodeBlockSelector(vditor.currentMode))) {
        const blockElement = block as HTMLElement;
        if (bindings.has(blockElement) && isLazyManagedCodeBlock(blockElement)) {
            mounted.push(blockElement);
        }
    }
    return mounted;
};

const enforceMaxMounted = (vditor: IVditor, keepBlock: HTMLElement) => {
    const mounted = getMountedCodeBlocks(vditor).filter((block) => block !== keepBlock);
    while (mounted.length >= LAZY_CM_MAX_MOUNTED) {
        let furthest: HTMLElement | null = null;
        let maxDistance = -1;
        const viewportCenter = window.innerHeight / 2;
        for (const block of mounted) {
            if (!isLazyManagedCodeBlock(block)) {
                continue;
            }
            const binding = bindings.get(block);
            if (binding?.view.hasFocus) {
                continue;
            }
            const rect = block.getBoundingClientRect();
            const blockCenter = rect.top + rect.height / 2;
            const distance = Math.abs(blockCenter - viewportCenter);
            if (distance > maxDistance) {
                maxDistance = distance;
                furthest = block;
            }
        }
        if (!furthest) {
            break;
        }
        destroyCodeMirror(furthest);
        mounted.splice(mounted.indexOf(furthest), 1);
    }
};

const scheduleSpecialBlock = (vditor: IVditor, blockElement: HTMLElement) => {
    if (isMathBlockElement(blockElement)) {
        syncMathBlockDisplayMode(vditor, blockElement);
        return;
    }
    if (blockElement.classList.contains(CM_EDITING_CLASS)) {
        mountCodeMirror(blockElement, vditor, true);
    } else {
        ensureSpecialCodeBlockPreview(blockElement, vditor);
    }
};

const scheduleLazyCodeBlock = (vditor: IVditor, blockElement: HTMLElement) => {
    if (isSpecialBlock(blockElement)) {
        scheduleSpecialBlock(vditor, blockElement);
        return;
    }
    if (isBlockNearViewport(blockElement)) {
        enforceMaxMounted(vditor, blockElement);
        mountCodeMirror(blockElement, vditor, true);
    } else {
        if (bindings.has(blockElement)) {
            cancelLazyTeardown(blockElement);
            destroyCodeMirror(blockElement);
        }
        showPlainCodeBlockPlaceholder(blockElement);
    }
    registerLazyCodeBlockVisibility(vditor, blockElement);
};

export const setupLazyCodeMirrorObserver = (_vditor: IVditor) => {
    if (lazyCodeMirrorObserver) {
        return;
    }
    lazyCodeMirrorObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const blockElement = entry.target as HTMLElement;
            const callback = lazyVisibilityCallbacks.get(blockElement);
            callback?.(entry.isIntersecting);
        }
    }, {
        root: null,
        rootMargin: `${LAZY_CM_VIEWPORT_MARGIN}px 0px`,
        threshold: 0,
    });
};

/** Regular code blocks keep only the hidden sync code + CodeMirror; special blocks keep the preview while editing, stacked vertically */
export const prepareCmBlockDom = (blockElement: HTMLElement, keepPreview = false) => {
    if (!isCmCodeBlock(blockElement) && !blockElement.classList.contains(CM_EDITING_CLASS)) {
        return;
    }
    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    const { editPre, code, preview } = parts;
    editPre.classList.remove(CM_PLACEHOLDER_CLASS);
    blockElement.classList.add(CM_BLOCK_CLASS);
    if (blockElement.classList.contains("vditor-ir__node")) {
        blockElement.classList.add("vditor-ir__node--expand");
    }
    editPre.classList.add(CM_HOST_CLASS);
    editPre.setAttribute("contenteditable", "false");
    editPre.style.display = "block";
    code.setAttribute("contenteditable", "false");
    code.setAttribute("hidden", "");
    code.setAttribute("aria-hidden", "true");
    code.style.display = "none";
    if (preview) {
        if (keepPreview) {
            preview.style.display = "";
        } else {
            preview.remove();
        }
    }
};

/** @deprecated use prepareCmBlockDom */
export const prepareWysiwygCmBlockDom = prepareCmBlockDom;

const loadLanguage = (languageName: string): Promise<LanguageSupport | undefined> => {
    return loadCodeMirrorHighlightLanguage(languageName);
};

const getSpecialPreviewLanguage = (blockElement: HTMLElement, preview: HTMLElement) => {
    const parts = getBlockParts(blockElement);
    if (parts) {
        const lang = getCodeLanguageName(parts.code);
        if (lang) {
            return lang;
        }
    }
    if (blockElement.getAttribute("data-type") === "math-block") {
        return "math";
    }
    const codeEl = preview.querySelector("code") as HTMLElement | null;
    const divEl = preview.querySelector("div.language-math, div[data-type='math-block']") as HTMLElement | null;
    return divEl ? "math" : (codeEl ? getCodeLanguageName(codeEl) : "");
};

const resetPreviewRenderElement = (
    preview: HTMLElement,
    source: string,
    language: string,
    blockElement: HTMLElement,
) => {
    if (isMathBlockElement(blockElement)) {
        let mathEl = preview.querySelector(
            "div[data-type='math-block'], div.language-math",
        ) as HTMLElement | null;
        if (!mathEl) {
            preview.querySelector("code")?.remove();
            mathEl = document.createElement("div");
            mathEl.setAttribute("data-type", "math-block");
            preview.replaceChildren(mathEl);
        }
        mathEl.className = "language-math";
        mathEl.removeAttribute("data-math");
        mathEl.classList.remove("vditor-reset--error");
        mathEl.textContent = source;
        return mathEl;
    }
    let codeEl = preview.querySelector(
        language === "plantuml" || language === "mermaid"
            ? `div.language-${language}, code.language-${language}`
            : "code",
    ) as HTMLElement | null;
    if (!codeEl) {
        codeEl = document.createElement(
            language === "plantuml" || language === "mermaid" ? "div" : "code",
        );
        preview.replaceChildren(codeEl);
    }
    codeEl.className = `language-${language}`;
    if (language === "mermaid") {
        codeEl.removeAttribute("data-vditor-mermaid-processed");
        codeEl.removeAttribute("data-mermaid");
        codeEl.removeAttribute("id");
        codeEl.classList.remove("vditor-reset--error");
    } else if (language === "math") {
        codeEl.removeAttribute("data-math");
        codeEl.classList.remove("vditor-reset--error");
    } else if (language === "plantuml") {
        codeEl.removeAttribute("data-plantuml");
        codeEl.classList.remove("vditor-reset--error");
    }
    codeEl.textContent = source;
    return codeEl;
};

const ensureSpecialSplitLayout = (blockElement: HTMLElement) => {
    const parts = getBlockParts(blockElement);
    if (!parts?.preview) {
        return;
    }
    blockElement.classList.add(CM_SPLIT_CLASS);
    // CodeMirror on top, rendered preview below (default DOM: editPre before preview)
    if (parts.preview.compareDocumentPosition(parts.editPre) & Node.DOCUMENT_POSITION_PRECEDING) {
        blockElement.insertBefore(parts.editPre, parts.preview);
    }
    parts.preview.style.display = "";
    parts.preview.style.pointerEvents = "none";
    parts.editPre.style.display = "block";
};

const rerenderSpecialPreview = (preview: HTMLElement, vditor: IVditor, source?: string) => {
    const blockElement = preview.closest("[data-type='code-block'], [data-type='math-block']") as HTMLElement;
    if (!blockElement) {
        return;
    }
    const language = getSpecialPreviewLanguage(blockElement, preview);
    if (!language) {
        return;
    }
    const parts = getBlockParts(blockElement);
    const codeText = source ?? parts?.code.textContent ?? "";
    resetPreviewRenderElement(preview, codeText, language, blockElement);
    if (language === "mermaid") {
        mermaidRender(preview, vditor.options.cdn, vditor);
    } else if (language === "plantuml") {
        plantumlRender(preview, vditor.options.cdn, vditor);
    } else if (language === "math") {
        mathRender(preview, { cdn: vditor.options.cdn, math: vditor.options.preview.math });
    }
    preview.setAttribute("data-render", "1");
};

const scheduleSpecialPreviewRerender = (
    blockElement: HTMLElement,
    binding: CodeMirrorBinding,
    vditor: IVditor,
) => {
    window.clearTimeout(binding.previewTimer);
    binding.previewTimer = window.setTimeout(() => {
        const parts = getBlockParts(blockElement);
        if (!parts?.preview) {
            return;
        }
        rerenderSpecialPreview(parts.preview, vditor, binding.view.state.doc.toString());
    }, 200);
};

const exitSpecialBlockEdit = (vditor: IVditor, blockElement: HTMLElement) => {
    if (!blockElement.classList.contains(CM_EDITING_CLASS)) {
        return;
    }
    const binding = bindings.get(blockElement);
    const finalText = binding?.view.state.doc.toString();
    if (binding) {
        window.clearTimeout(binding.syncTimer);
        window.clearTimeout(binding.previewTimer);
        binding.syncCode.textContent = finalText ?? binding.syncCode.textContent;
        binding.view.destroy();
        bindings.delete(blockElement);
        binding.editPre.querySelector(".cm-editor")?.remove();
        removeCodeBlockChrome(blockElement);
    }
    blockElement.classList.remove(CM_BLOCK_CLASS, CM_EDITING_CLASS, CM_SPLIT_CLASS);
    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    parts.editPre.classList.remove(CM_HOST_CLASS);
    parts.editPre.style.display = "none";
    parts.code.removeAttribute("hidden");
    parts.code.removeAttribute("aria-hidden");
    parts.code.style.display = "";
    if (parts.preview) {
        parts.preview.style.display = "";
        parts.preview.style.pointerEvents = "";
        rerenderSpecialPreview(parts.preview, vditor, finalText);
    }
    if (isMathBlockElement(blockElement)) {
        ensureMathBlockPreviewMode(blockElement);
    }
    if (vditor.currentMode === "wysiwyg") {
        clearTimeout(vditor.wysiwyg.afterRenderTimeoutId);
        recordWysiwygHistory(vditor, {
            enableAddUndoStack: true,
            enableHint: false,
            enableInput: true,
        });
        afterRenderEvent(vditor, {
            enableAddUndoStack: false,
            enableHint: false,
            enableInput: true,
        });
    } else if (vditor.currentMode === "ir") {
        clearTimeout(vditor.ir.processTimeoutId);
        recordIrHistory(vditor, {
            enableAddUndoStack: true,
            enableHint: false,
            enableInput: true,
        });
        processAfterRender(vditor, {
            enableAddUndoStack: false,
            enableHint: false,
            enableInput: true,
        });
    }
};

/** Math / Mermaid / PlantUML: CodeMirror on top, preview below, redrawn live while editing */
export const enterSpecialBlockEdit = (vditor: IVditor, blockElement: HTMLElement, focus = true) => {
    const block = normalizeCmBlockElement(blockElement, getModeEditor(vditor)) || blockElement;
    if (!isSpecialBlock(block)) {
        return false;
    }
    if (block.classList.contains(CM_EDITING_CLASS)) {
        if (focus) {
            focusCodeMirror(block, true, vditor);
        }
        return true;
    }
    block.classList.add(CM_EDITING_CLASS);
    ensureSpecialSplitLayout(block);
    mountCodeMirror(block, vditor, true);
    const binding = bindings.get(block);
    const parts = getBlockParts(block);
    if (binding && parts?.preview) {
        rerenderSpecialPreview(parts.preview, vditor, binding.view.state.doc.toString());
    }
    if (focus) {
        focusCodeMirror(block, true, vditor);
    }
    return true;
};

const syncRenderOptions = {
    enableAddUndoStack: false,
    enableHint: false,
    enableInput: true,
};

const scheduleSync = (binding: CodeMirrorBinding, vditor: IVditor) => {
    window.clearTimeout(binding.syncTimer);
    binding.syncTimer = window.setTimeout(() => {
        if (vditor.currentMode === "wysiwyg") {
            afterRenderEvent(vditor, syncRenderOptions);
        } else if (vditor.currentMode === "ir") {
            processAfterRender(vditor, syncRenderOptions);
        }
    }, vditor.options.undoDelay);
};

/** Merge code block changes into the outer Vditor undo stack when leaving CodeMirror */
export const flushCodeMirrorExternalUndo = (vditor: IVditor) => {
    if (isInsideCodeMirror(document.activeElement)) {
        return;
    }
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }
    for (const block of editor.querySelectorAll(`.${CM_BLOCK_CLASS}`)) {
        const binding = bindings.get(block as HTMLElement);
        if (!binding) {
            continue;
        }
        window.clearTimeout(binding.syncTimer);
        window.clearTimeout(binding.previewTimer);
        binding.syncCode.textContent = binding.view.state.doc.toString();
    }
    const recordOptions = {
        enableAddUndoStack: true,
        enableHint: false,
        enableInput: true,
    };
    if (vditor.currentMode === "wysiwyg") {
        clearTimeout(vditor.wysiwyg.afterRenderTimeoutId);
        recordWysiwygHistory(vditor, recordOptions);
    } else if (vditor.currentMode === "ir") {
        clearTimeout(vditor.ir.processTimeoutId);
        recordIrHistory(vditor, recordOptions);
    }
};

export const getActiveCodeMirrorView = (): EditorView | undefined => {
    const cmEditor = document.activeElement?.closest(".cm-editor");
    if (!cmEditor) {
        return undefined;
    }
    const blockElement = cmEditor.closest("[data-type='code-block'], [data-type='math-block']") as HTMLElement | null;
    if (!blockElement) {
        return undefined;
    }
    return bindings.get(blockElement)?.view;
};

export const canUndoActiveCodeMirror = () => {
    const view = getActiveCodeMirrorView();
    return !!view && undoDepth(view.state) > 0;
};

export const canRedoActiveCodeMirror = () => {
    const view = getActiveCodeMirrorView();
    return !!view && redoDepth(view.state) > 0;
};

export const undoActiveCodeMirror = () => {
    const view = getActiveCodeMirrorView();
    if (!view || undoDepth(view.state) === 0) {
        return false;
    }
    return undo(view);
};

export const redoActiveCodeMirror = () => {
    const view = getActiveCodeMirrorView();
    if (!view || redoDepth(view.state) === 0) {
        return false;
    }
    return redo(view);
};

const syncCodeFromView = (binding: CodeMirrorBinding, vditor: IVditor, blockElement: HTMLElement) => {
    binding.syncCode.textContent = binding.view.state.doc.toString();
    if (isSpecialBlock(blockElement) && blockElement.classList.contains(CM_EDITING_CLASS)) {
        scheduleSpecialPreviewRerender(blockElement, binding, vditor);
        return;
    }
    scheduleSync(binding, vditor);
};

const syncViewFromCode = (binding: CodeMirrorBinding) => {
    const codeText = binding.syncCode.textContent || "";
    const cmText = binding.view.state.doc.length ? binding.view.state.doc.toString() : "";
    if (codeText === cmText) {
        return;
    }
    binding.updating = true;
    binding.view.dispatch({
        changes: { from: 0, to: binding.view.state.doc.length, insert: codeText },
    });
    binding.updating = false;
};

const insertLiteralTab = (view: EditorView) => {
    view.dispatch(view.state.update(view.state.replaceSelection("\t"), {
        scrollIntoView: true,
        userEvent: "input",
    }));
    return true;
};

const applyLanguage = (blockElement: HTMLElement, binding: CodeMirrorBinding, languageName: string) => {
    if (binding.languageName === languageName) {
        return;
    }
    if (!languageName) {
        binding.view.dispatch({
            effects: binding.languageCompartment.reconfigure([]),
        });
        binding.languageName = "";
        return;
    }
    loadLanguage(languageName).then((lang) => {
        if (!lang || !bindings.has(blockElement)) {
            return;
        }
        binding.view.dispatch({
            effects: binding.languageCompartment.reconfigure(lang),
        });
        binding.languageName = languageName;
    });
};

const getCmSelectionText = (view: EditorView) => {
    const parts: string[] = [];
    for (const range of view.state.selection.ranges) {
        parts.push(view.state.sliceDoc(range.from, range.to));
    }
    return parts.join("\n");
};

const resolveCodeMirrorCopyText = (
    view: EditorView,
    wholeDocumentIfNoSelection = false,
): string => {
    const payload = resolveCodeMirrorCopyPayload(view, "", wholeDocumentIfNoSelection);
    return payload?.plain ?? "";
};

const writeCodeMirrorCopyToClipboard = async (
    plain: string,
    html: string,
): Promise<boolean> => {
    if (!plain) {
        return false;
    }
    if (navigator.clipboard?.write) {
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/plain": new Blob([plain], { type: "text/plain" }),
                    "text/html": new Blob([html], { type: "text/html" }),
                }),
            ]);
            return true;
        } catch {
            // fall through to plain text
        }
    }
    try {
        await navigator.clipboard.writeText(plain);
        return true;
    } catch {
        const textarea = document.createElement("textarea");
        textarea.value = plain;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        return copied;
    }
};

/** Toolbar copy: plain text + HTML with syntax highlighting styles */
export const copyCodeMirrorView = async (
    view: EditorView,
    languageName = "",
    wholeDocumentIfNoSelection = true,
): Promise<boolean> => {
    const payload = resolveCodeMirrorCopyPayload(view, languageName, wholeDocumentIfNoSelection);
    if (!payload) {
        return false;
    }
    return writeCodeMirrorCopyToClipboard(payload.plain, payload.html);
};

/** Without a selection, cut the whole line (including its trailing newline, except on the last line) */
const getCmCutRange = (view: EditorView) => {
    const { from, to } = view.state.selection.main;
    if (from !== to) {
        return { from, to, text: getCmSelectionText(view) };
    }
    const line = view.state.doc.lineAt(from);
    const cutFrom = line.from;
    const cutTo = line.number < view.state.doc.lines ? line.to + 1 : line.to;
    return { from: cutFrom, to: cutTo, text: view.state.sliceDoc(cutFrom, cutTo) };
};

const clearCmSelection = (view: EditorView) => {
    const { from, to, head } = view.state.selection.main;
    if (from === to) {
        return;
    }
    view.dispatch({
        selection: EditorSelection.cursor(head),
    });
};

const focusEditorWithoutScroll = (editor: HTMLElement) => {
    editor.focus({ preventScroll: true });
};

const scrollEditorAfterBlockInsert = (vditor: IVditor, range: Range, scrollTarget?: HTMLElement) => {
    requestAnimationFrame(() => {
        if (scrollTarget) {
            scrollElementIntoEditorView(vditor, scrollTarget);
        }
        scrollCaretIntoEditorView(vditor, range);
    });
};

const focusCmViewWithoutScroll = (view: EditorView) => {
    view.contentDOM.focus({ preventScroll: true });
};

const cmDomEventHandlers = (vditor: IVditor, blockElement: HTMLElement, binding: CodeMirrorBinding) => ({
    mousedown: (event: Event) => {
        event.stopPropagation();
    },
    focus: () => false,
    blur: () => {
        window.setTimeout(() => {
            if (!bindings.has(blockElement) || binding.view.hasFocus) {
                return;
            }
            if (blockElement.contains(document.activeElement)) {
                return;
            }
            clearCmSelection(binding.view);
            if (isSpecialBlock(blockElement) && blockElement.classList.contains(CM_EDITING_CLASS)) {
                if (isMathBlockElement(blockElement) && isMathBlockEmpty(blockElement)) {
                    return;
                }
                exitSpecialBlockEdit(vditor, blockElement);
            } else {
                flushCodeMirrorExternalUndo(vditor);
            }
            vditor.undo.resetIcon(vditor);
        }, 0);
        return false;
    },
    click: (event: Event) => {
        event.stopPropagation();
    },
    copy: (event: Event) => {
        const clipboardEvent = event as ClipboardEvent;
        const view = binding.view;
        if (!view?.state || !clipboardEvent.clipboardData) {
            return false;
        }
        const payload = resolveCodeMirrorCopyPayload(view, binding.languageName, false);
        if (!payload) {
            return false;
        }
        event.stopPropagation();
        clipboardEvent.preventDefault();
        clipboardEvent.clipboardData.setData("text/plain", payload.plain);
        clipboardEvent.clipboardData.setData("text/html", payload.html);
        return true;
    },
    cut: (event: Event) => {
        const clipboardEvent = event as ClipboardEvent;
        const view = binding.view;
        if (!view?.state || !clipboardEvent.clipboardData) {
            return false;
        }
        const { from, to, text } = getCmCutRange(view);
        if (from === to) {
            return false;
        }
        event.stopPropagation();
        clipboardEvent.preventDefault();
        clipboardEvent.clipboardData.setData("text/plain", text);
        view.dispatch({
            changes: { from, to, insert: "" },
            selection: EditorSelection.cursor(from),
        });
        syncCodeFromView(binding, vditor, blockElement);
        return true;
    },
    paste: (event: Event) => {
        const clipboardEvent = event as ClipboardEvent;
        const view = binding.view;
        if (!view?.state || !clipboardEvent.clipboardData) {
            return false;
        }
        const text = clipboardEvent.clipboardData.getData("text/plain");
        event.stopPropagation();
        clipboardEvent.preventDefault();
        if (text) {
            view.dispatch(view.state.replaceSelection(text));
            syncCodeFromView(binding, vditor, blockElement);
        }
        return true;
    },
    keydown: (event: Event) => {
        if ((event as KeyboardEvent).defaultPrevented) {
            event.stopPropagation();
        }
    },
    input: (event: Event) => {
        event.stopPropagation();
    },
});

const canFocusAdjacentEditorBlock = (
    blockElement: HTMLElement,
    direction: "up" | "down",
): boolean => {
    const adjacentElement = direction === "up"
        ? blockElement.previousElementSibling as HTMLElement | null
        : blockElement.nextElementSibling as HTMLElement | null;
    if (!adjacentElement) {
        return false;
    }
    return !adjacentElement.classList.contains("vditor-editor-boundary");
};

const focusAdjacentEditorBlock = (
    vditor: IVditor,
    blockElement: HTMLElement,
    direction: "up" | "down",
) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }

    const focusBlockPosition = (element: HTMLElement, toStart: boolean) => {
        focusEditorWithoutScroll(editor);
        const range = getEditorRange(vditor);
        range.selectNodeContents(element);
        range.collapse(toStart);
        setSelectionFocus(range);
        if (vditor.currentMode === "ir") {
            expandMarker(range, vditor.ir.element);
            syncIrMathBlockAfterExpand(vditor, range);
        }
    };

    const insertAdjacentEmptyBlock = (position: "before" | "after") => {
        const html = `<p data-block="0">${Constants.ZWSP}<wbr></p>`;
        if (position === "before") {
            blockElement.insertAdjacentHTML("beforebegin", html);
        } else {
            blockElement.insertAdjacentHTML("afterend", html);
        }
        focusEditorWithoutScroll(editor);
        const range = getEditorRange(vditor);
        setRangeByWbr(editor, range);
        setSelectionFocus(range);
        const newBlock = position === "before"
            ? blockElement.previousElementSibling
            : blockElement.nextElementSibling;
        scrollEditorAfterBlockInsert(vditor, range, newBlock instanceof HTMLElement ? newBlock : undefined);
    };

    if (direction === "up") {
        const previousElement = blockElement.previousElementSibling as HTMLElement | null;
        if (isCmCodeBlock(previousElement)) {
            focusCodeMirror(previousElement, false, vditor);
        } else if (!previousElement ||
            previousElement.tagName === "TABLE" ||
            previousElement.getAttribute("data-type")) {
            insertAdjacentEmptyBlock("before");
        } else {
            focusBlockPosition(previousElement, false);
        }
        return;
    }

    const nextElement = blockElement.nextElementSibling as HTMLElement | null;
    if (isCmCodeBlock(nextElement)) {
        focusCodeMirror(nextElement, true, vditor);
    } else if (!nextElement ||
        nextElement.tagName === "TABLE" ||
        nextElement.getAttribute("data-type")) {
        insertAdjacentEmptyBlock("after");
    } else {
        focusBlockPosition(nextElement, true);
    }
};

const exitCodeMirrorToAdjacentBlock = (
    view: EditorView,
    vditor: IVditor,
    blockElement: HTMLElement,
    direction: "up" | "down",
) => {
    view.contentDOM.blur();
    focusAdjacentEditorBlock(vditor, blockElement, direction);
};

const buildCodeMirrorNavigationKeymap = (vditor: IVditor, blockElement: HTMLElement) =>
    Prec.high(keymap.of([
        {
            key: "Backspace",
            run: (view) => {
                const { from, to } = view.state.selection.main;
                if (from !== to || from !== 0 || !isEmptyCmDoc(view)) {
                    return false;
                }
                removeCmCodeBlock(vditor, blockElement);
                return true;
            },
        },
        {
            key: "ArrowUp",
            run: (view) => {
                const line = view.state.doc.lineAt(view.state.selection.main.head);
                if (line.number > 1) {
                    return false;
                }
                if (!canFocusAdjacentEditorBlock(blockElement, "up")) {
                    return false;
                }
                exitCodeMirrorToAdjacentBlock(view, vditor, blockElement, "up");
                return true;
            },
        },
        {
            key: "ArrowDown",
            run: (view) => {
                const line = view.state.doc.lineAt(view.state.selection.main.head);
                if (line.number < view.state.doc.lines) {
                    return false;
                }
                if (!canFocusAdjacentEditorBlock(blockElement, "down")) {
                    return false;
                }
                exitCodeMirrorToAdjacentBlock(view, vditor, blockElement, "down");
                return true;
            },
        },
        {
            key: "Ctrl-Enter",
            mac: "Cmd-Enter",
            run: (view) => {
                const line = view.state.doc.lineAt(view.state.selection.main.head);
                if (line.number < view.state.doc.lines) {
                    return false;
                }
                const editor = getModeEditor(vditor);
                if (!editor) {
                    return false;
                }
                view.contentDOM.blur();
                const html = `<p data-block="0">${Constants.ZWSP}<wbr></p>`;
                blockElement.insertAdjacentHTML("afterend", html);
                focusEditorWithoutScroll(editor);
                const range = getEditorRange(vditor);
                setRangeByWbr(editor, range);
                setSelectionFocus(range);
                const newBlock = blockElement.nextElementSibling;
                scrollEditorAfterBlockInsert(vditor, range, newBlock instanceof HTMLElement ? newBlock : undefined);
                return true;
            },
        },
    ]));

export const removeCmCodeBlock = (vditor: IVditor, blockElement: HTMLElement) => {
    if (!isCmCodeBlock(blockElement)) {
        return;
    }

    const editor = getModeEditor(vditor);
    if (!editor) {
        blockElement.remove();
        return;
    }

    const previousElement = blockElement.previousElementSibling as HTMLElement | null;
    const nextElement = blockElement.nextElementSibling as HTMLElement | null;

    const binding = bindings.get(blockElement);
    if (binding) {
        window.clearTimeout(binding.syncTimer);
        window.clearTimeout(binding.previewTimer);
        binding.syncCode.textContent = binding.view.state.doc.toString();
        binding.view.destroy();
        bindings.delete(blockElement);
        binding.editPre.querySelector(".cm-editor")?.remove();
    }
    removeCodeBlockChrome(blockElement);
    blockElement.remove();

    focusEditorWithoutScroll(editor);
    const range = getEditorRange(vditor);

    if (previousElement) {
        if (isCmCodeBlock(previousElement)) {
            focusCodeMirror(previousElement, false, vditor);
        } else {
            range.selectNodeContents(previousElement);
            range.collapse(false);
            setSelectionFocus(range);
            if (vditor.currentMode === "ir") {
                expandMarker(range, vditor.ir.element);
                syncIrMathBlockAfterExpand(vditor, range);
            }
        }
    } else if (nextElement) {
        if (isCmCodeBlock(nextElement)) {
            focusCodeMirror(nextElement, true, vditor);
        } else {
            range.selectNodeContents(nextElement);
            range.collapse(true);
            setSelectionFocus(range);
            if (vditor.currentMode === "ir") {
                expandMarker(range, vditor.ir.element);
                syncIrMathBlockAfterExpand(vditor, range);
            }
        }
    } else {
        editor.insertAdjacentHTML("beforeend", `<p data-block="0">${Constants.ZWSP}<wbr></p>`);
        setRangeByWbr(editor, range);
        setSelectionFocus(range);
    }

    if (vditor.currentMode === "wysiwyg") {
        clearTimeout(vditor.wysiwyg.afterRenderTimeoutId);
        vditor.undo.addToUndoStack(vditor);
        afterRenderEvent(vditor, {
            enableAddUndoStack: false,
            enableHint: false,
            enableInput: true,
        });
    } else if (vditor.currentMode === "ir") {
        clearTimeout(vditor.ir.processTimeoutId);
        vditor.undo.addToUndoStack(vditor);
        processAfterRender(vditor, {
            enableAddUndoStack: false,
            enableHint: false,
            enableInput: true,
        });
    }
};

export const destroyAllCodeMirrors = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }
    editor.querySelectorAll(`.${CM_BLOCK_CLASS}`).forEach((block) => {
        destroyCodeMirror(block as HTMLElement);
    });
};

/** @deprecated use destroyAllCodeMirrors */
export const destroyAllWysiwygCodeMirrors = destroyAllCodeMirrors;

/** Unmount CodeMirror before spinning the DOM, keeping the sync code hidden */
export const deactivateAllCodeMirrors = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }
    for (const block of editor.querySelectorAll(getCodeBlockSelector(vditor.currentMode))) {
        const blockElement = block as HTMLElement;
        if (bindings.has(blockElement)) {
            destroyCodeMirror(blockElement);
        }
    }
};

/** @deprecated use deactivateAllCodeMirrors */
export const deactivateAllWysiwygCodeMirrors = deactivateAllCodeMirrors;

const collectCodeBlocksInScope = (vditor: IVditor, scope: HTMLElement) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return [] as HTMLElement[];
    }
    if (scope === editor) {
        return Array.from(editor.querySelectorAll(getCodeBlockSelector(vditor.currentMode))) as HTMLElement[];
    }
    const selector = getCodeBlockSelector(vditor.currentMode);
    const blocks: HTMLElement[] = [];
    if (scope.matches(selector)) {
        blocks.push(scope);
    }
    scope.querySelectorAll(selector).forEach((block) => {
        blocks.push(block as HTMLElement);
    });
    return blocks;
};

/** Before spin, unmount only the CodeMirror instances within the scope */
export const deactivateCodeMirrorsInScope = (vditor: IVditor, scope: HTMLElement) => {
    deactivateInlineMathEditorsInScope(scope);
    for (const blockElement of collectCodeBlocksInScope(vditor, scope)) {
        if (bindings.has(blockElement)) {
            destroyCodeMirror(blockElement);
        }
    }
};

/** After spin, rebuild only the CodeMirror instances within the scope that need editing */
export const renderCodeBlocksInScope = (vditor: IVditor, scope: HTMLElement) => {
    for (const blockElement of collectCodeBlocksInScope(vditor, scope)) {
        scheduleLazyCodeBlock(vditor, blockElement);
    }
};

const getCmBlockFromNode = (node: Node | null, editorElement: HTMLElement): HTMLElement | null => {
    let current: Node | null = node;
    while (current && current !== editorElement) {
        if (current instanceof HTMLElement) {
            const block = normalizeCmBlockElement(current, editorElement);
            if (block) {
                return block;
            }
        }
        current = current.parentElement;
    }
    return null;
};

/** Lute also puts data-type="math-block" on the inner code; normalize to the outer block where CM can be mounted */
const normalizeCmBlockElement = (element: HTMLElement, editorElement: HTMLElement | null): HTMLElement | null => {
    let block: HTMLElement | null = element;
    while (block && block !== editorElement) {
        const dataType = block.getAttribute("data-type");
        if (dataType && CM_BLOCK_DATA_TYPES.has(dataType) && getBlockParts(block)) {
            return block;
        }
        block = block.parentElement;
    }
    return null;
};

const stripHtmlForBlockTrigger = (html: string) =>
    html.replace(/<wbr\s*\/?>/gi, "")
        .replace(/\u200b/g, "")
        .replace(/<[^>]+>/g, "")
        .trim();

/** Whether a math block was just created by typing $$ (the second $ was just typed) */
export const isMathBlockCreateTrigger = (spinBeforeHtml: string) => {
    const text = stripHtmlForBlockTrigger(spinBeforeHtml);
    return text === "$$" || text === "$$\n";
};

const spinHtmlHadMathBlock = (html: string) => /data-type=["']math-block["']/.test(html);

/** Whether to focus the empty math block at the caret after spin (new block, or explicit $$ trigger) */
const shouldFocusNewEmptyMathBlock = (spinBeforeHtml: string, blockElement: HTMLElement | null) => {
    if (!blockElement || !isMathBlockElement(blockElement) || !isMathBlockEmpty(blockElement)) {
        return false;
    }
    if (isMathBlockCreateTrigger(spinBeforeHtml)) {
        return true;
    }
    return !spinHtmlHadMathBlock(spinBeforeHtml);
};

const focusEmptyMathBlockAtCursor = (vditor: IVditor, blockElement: HTMLElement) => {
    const editor = getModeEditor(vditor);
    const apply = () => {
        if (!blockElement.isConnected) {
            return;
        }
        const block = normalizeCmBlockElement(blockElement, editor) || blockElement;
        if (!isMathBlockElement(block) || !isMathBlockEmpty(block)) {
            return;
        }
        if (!block.classList.contains(CM_EDITING_CLASS)) {
            enterSpecialBlockEdit(vditor, block, true);
            return;
        }
        focusCodeMirror(block, true, vditor);
    };
    apply();
    window.setTimeout(apply, 0);
};

/** After spin: focus CodeMirror when the caret is inside a newly created/triggered empty math block */
export const focusEmptyMathBlockAfterSpin = (
    vditor: IVditor,
    editorElement: HTMLElement,
    range: Range,
    spinBeforeHtml: string,
): boolean => {
    const blockElement = getCmBlockFromRange(range, editorElement);
    if (!shouldFocusNewEmptyMathBlock(spinBeforeHtml, blockElement)) {
        return false;
    }
    focusEmptyMathBlockAtCursor(vditor, blockElement as HTMLElement);
    return true;
};

/** Whether a code block was just created by typing ``` */
export const isCodeBlockCreateTrigger = (spinBeforeHtml: string) => {
    const text = stripHtmlForBlockTrigger(spinBeforeHtml);
    return text === "```" || /^```[\w-]*$/.test(text);
};

const getCmBlockFromRange = (range: Range, editorElement: HTMLElement): HTMLElement | null => {
    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
    }
    if (!(node instanceof HTMLElement)) {
        return null;
    }
    return getCmBlockFromNode(node, editorElement);
};

/** After spin, automatically enter the CodeMirror of the block matching the trigger ($$ / ```) */
export const autoFocusCreatedBlockAfterSpin = (
    vditor: IVditor,
    editorElement: HTMLElement,
    range: Range,
    spinBeforeHtml: string,
): boolean => {
    const blockElement = getCmBlockFromRange(range, editorElement);
    if (!blockElement) {
        return false;
    }
    if (isMathBlockCreateTrigger(spinBeforeHtml) && isMathBlockElement(blockElement)) {
        focusEmptyMathBlockAtCursor(vditor, blockElement);
        return true;
    }
    if (isCodeBlockCreateTrigger(spinBeforeHtml) && blockElement.getAttribute("data-type") === "code-block") {
        if (!bindings.has(blockElement)) {
            mountCodeMirror(blockElement, vditor, true);
        }
        focusCodeMirror(blockElement, true, vditor);
        return true;
    }
    return false;
};

/** @deprecated use autoFocusCreatedBlockAfterSpin */
export const autoEnterCreatedMathBlock = (
    vditor: IVditor,
    editorElement: HTMLElement,
    spinBeforeHtml: string,
): boolean => {
    return autoFocusCreatedBlockAfterSpin(vditor, editorElement, getEditorRange(vditor), spinBeforeHtml);
};

/** After spin, if the caret is inside a regular code block, mount and focus CodeMirror */
export const focusCmBlockAtCursor = (vditor: IVditor, editorElement: HTMLElement) => {
    const blockElement = getCmBlockFromRange(getEditorRange(vditor), editorElement);
    if (!blockElement || isMathBlockElement(blockElement)) {
        return;
    }
    focusCodeBlock(blockElement, vditor, true);
};

const isEmptyCmDoc = (view: EditorView) => view.state.doc.toString().trim() === "";

/** After a full-page DOM replacement (undo/redo etc.), clean up leftover CM mounts and reinitialize */
export const remountCodeMirrorsAfterDomReplace = (vditor: IVditor) => {
    if (vditor.currentMode !== "wysiwyg" && vditor.currentMode !== "ir") {
        return;
    }
    renderCodeBlocks(vditor);
};

const cleanupStaleCmArtifacts = (blockElement: HTMLElement) => {
    if (bindings.has(blockElement)) {
        return;
    }
    removeCodeBlockChrome(blockElement);
    blockElement.querySelectorAll(".vditor-cm-chrome").forEach((chrome) => {
        chrome.remove();
    });
    blockElement.querySelectorAll(".cm-editor").forEach((editor) => {
        editor.remove();
    });
};

const mountCodeMirror = (blockElement: HTMLElement, vditor: IVditor, force = false) => {
    if (!force && !isCmCodeBlock(blockElement)) {
        return;
    }

    cancelLazyTeardown(blockElement);
    blockElement.classList.remove(CM_PLACEHOLDER_CLASS);

    cleanupStaleCmArtifacts(blockElement);
    prepareCmBlockDom(blockElement, isSpecialBlock(blockElement));

    const parts = getBlockParts(blockElement);
    if (!parts) {
        return;
    }
    if (isMathBlockElement(blockElement)) {
        parts.code.classList.add("language-math");
    }

    const existing = bindings.get(blockElement);
    if (existing) {
        syncViewFromCode(existing);
        const languageName = getLanguageName(parts.code);
        if (existing.languageName !== languageName) {
            existing.syncCode.className = parts.code.className;
            applyLanguage(blockElement, existing, languageName);
        }
        ensureCodeBlockChrome(vditor, blockElement, {
            performCopy: () => copyCodeMirrorView(existing.view, existing.languageName),
        });
        updateCodeBlockChromeLanguage(blockElement, languageName);
        return;
    }

    const { editPre, code } = parts;
    const languageCompartment = new Compartment();
    const languageName = getLanguageName(code);

    const binding: CodeMirrorBinding = {
        view: null as unknown as EditorView,
        languageCompartment,
        editPre,
        syncCode: code,
        updating: false,
        syncTimer: 0,
        previewTimer: 0,
        languageName: "",
    };

    const rawCode = code.textContent || "";

    const view = new EditorView({
        // Lute bug: it appends an empty line at the end of code blocks
        doc: rawCode.trimEnd(),
        parent: editPre,
        extensions: [
            vditorCodeMirrorSetup,
            keymap.of(stopHandledCodeMirrorKeymap([{ key: "Tab", run: insertLiteralTab, shift: indentLess }])),
            buildCodeMirrorNavigationKeymap(vditor, blockElement),
            languageCompartment.of([]),
            EditorView.updateListener.of((update) => {
                if (binding.updating || !update.docChanged) {
                    return;
                }
                syncCodeFromView(binding, vditor, blockElement);
                vditor.undo.resetIcon(vditor);
            }),
            EditorView.domEventHandlers(cmDomEventHandlers(vditor, blockElement, binding)),
        ],
    });

    binding.view = view;
    bindings.set(blockElement, binding);
    applyLanguage(blockElement, binding, languageName);
    ensureCodeBlockChrome(vditor, blockElement, {
        performCopy: () => copyCodeMirrorView(binding.view, binding.languageName),
    });
};

export const renderCodeBlocks = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }
    for (const block of editor.querySelectorAll(getCodeBlockSelector(vditor.currentMode))) {
        scheduleLazyCodeBlock(vditor, block as HTMLElement);
    }
    syncMathBlocksDisplayMode(editor, vditor);
};

/** @deprecated use renderCodeBlocks */
export const renderWysiwygCodeBlocks = renderCodeBlocks;

export const restoreCodeMirrorFocus = (
    blockElement: HTMLElement,
    anchor: number,
    head: number,
    vditor: IVditor,
) => {
    if (!blockElement) {
        return;
    }
    if (!bindings.get(blockElement)) {
        mountCodeMirror(blockElement, vditor, true);
    }
    const binding = bindings.get(blockElement);
    if (!binding) {
        return;
    }
    const apply = () => {
        const docLength = binding.view.state.doc.length;
        const safeAnchor = Math.max(0, Math.min(anchor, docLength));
        const safeHead = Math.max(0, Math.min(head, docLength));
        binding.view.dispatch({
            selection: { anchor: safeAnchor, head: safeHead },
            scrollIntoView: false,
        });
        focusCmViewWithoutScroll(binding.view);
    };
    preserveEditorScroll(vditor, apply);
};

export const focusCodeMirror = (
    blockElement: HTMLElement,
    collapseToStart = true,
    vditor?: IVditor,
) => {
    if (!blockElement) {
        return;
    }
    if (!bindings.get(blockElement) && vditor) {
        if (isLazyManagedCodeBlock(blockElement)) {
            enforceMaxMounted(vditor, blockElement);
        }
        mountCodeMirror(blockElement, vditor, true);
    }
    const binding = bindings.get(blockElement);
    if (!binding) {
        return;
    }
    const hadFocus = binding.view.hasFocus;
    const applyFocus = () => {
        focusCmViewWithoutScroll(binding.view);
        if (!hadFocus) {
            if (collapseToStart) {
                binding.view.dispatch({
                    selection: { anchor: 0, head: 0 },
                    scrollIntoView: false,
                });
            } else {
                const length = binding.view.state.doc.length;
                binding.view.dispatch({
                    selection: { anchor: length, head: length },
                    scrollIntoView: false,
                });
            }
        }
    };
    if (vditor) {
        preserveEditorScroll(vditor, applyFocus);
    } else {
        applyFocus();
    }
};

/** @deprecated use focusCodeMirror */
export const focusWysiwygCodeMirror = focusCodeMirror;

export const focusCodeBlock = (blockElement: HTMLElement, vditor: IVditor, collapseToStart = true) => {
    if (isSpecialPreviewBlock(blockElement)) {
        return enterSpecialBlockEdit(vditor, blockElement);
    }
    if (!isCmCodeBlock(blockElement)) {
        return false;
    }
    focusCodeMirror(blockElement, collapseToStart, vditor);
    return true;
};

export const updateCodeMirrorLanguage = (blockElement: HTMLElement, languageName: string) => {
    const lang = languageName.trim();
    const binding = bindings.get(blockElement);
    if (binding) {
        binding.syncCode.className = lang ? `language-${lang}` : "";
        applyLanguage(blockElement, binding, lang);
    }
    const infoElement = blockElement.querySelector('[data-type="code-block-info"]') as HTMLElement;
    if (infoElement) {
        infoElement.textContent = Constants.ZWSP + lang;
    }
    updateCodeBlockChromeLanguage(blockElement, lang);
};

/** @deprecated use updateCodeMirrorLanguage */
export const updateWysiwygCodeMirrorLanguage = updateCodeMirrorLanguage;

export const hasCodeMirror = (blockElement: HTMLElement) => bindings.has(blockElement);

/** @deprecated use hasCodeMirror */
export const hasWysiwygCodeMirror = hasCodeMirror;

export const getCodeMirrorView = (blockElement: HTMLElement) => bindings.get(blockElement)?.view;

/** @deprecated use getCodeMirrorView */
export const getWysiwygCodeMirrorView = getCodeMirrorView;

const resolveLanguageFromCmDom = (root: ParentNode): string => {
    const chromeLang = (root as HTMLElement).querySelector(".vditor-cm-chrome__lang")?.getAttribute("data-lang");
    if (chromeLang && chromeLang !== "plain") {
        return chromeLang;
    }
    const syncCode = root.querySelector("pre code, code");
    if (syncCode) {
        const fromCode = getCodeLanguageName(syncCode as HTMLElement);
        if (fromCode) {
            return fromCode;
        }
    }
    const cmLang = root.querySelector(".cm-content")?.getAttribute("data-language");
    if (cmLang) {
        return cmLang;
    }
    const infoEl = root.querySelector('[data-type="code-block-info"]');
    if (infoEl?.textContent) {
        const info = infoEl.textContent.replace(Constants.ZWSP, "").trim();
        if (info) {
            return info;
        }
    }
    return "";
};

const resolveCodeTextFromCmDom = (root: ParentNode): string => {
    const syncCode = root.querySelector("pre code");
    if (syncCode?.textContent) {
        return syncCode.textContent;
    }
    const cmContent = root.querySelector(".cm-content");
    if (cmContent) {
        return cmContent.textContent || "";
    }
    return "";
};

const resolveCmBlockLanguage = (liveBlock: HTMLElement, binding?: CodeMirrorBinding): string => {
    if (binding?.languageName) {
        return binding.languageName;
    }
    const parts = getBlockParts(liveBlock);
    if (parts) {
        const fromCode = getCodeLanguageName(parts.code);
        if (fromCode) {
            return fromCode;
        }
    }
    return resolveLanguageFromCmDom(liveBlock);
};

const resolveCmBlockCodeText = (liveBlock: HTMLElement, binding?: CodeMirrorBinding): string => {
    if (binding) {
        return binding.view.state.doc.toString();
    }
    if (isMathBlockElement(liveBlock)) {
        const parts = getBlockParts(liveBlock);
        return (parts?.code.textContent || "").replaceAll(Constants.ZWSP, "");
    }
    const parts = getBlockParts(liveBlock);
    if (parts?.code.textContent) {
        return parts.code.textContent;
    }
    return resolveCodeTextFromCmDom(liveBlock);
};

const COPY_SANITIZE_BLOCK_SELECTOR = [
    ".vditor-wysiwyg__block[data-type='code-block']",
    ".vditor-wysiwyg__block[data-type='math-block']",
    ".vditor-wysiwyg__block[data-type='math-inline']",
    ".vditor-wysiwyg__block[data-type='yaml-front-matter']",
    ".vditor-ir__node[data-type='code-block']",
    ".vditor-ir__node[data-type='math-block']",
    ".vditor-ir__node[data-type='math-inline']",
    ".vditor-ir__node[data-type='yaml-front-matter']",
].join(", ");

const isOutermostSanitizeBlock = (el: HTMLElement): boolean => {
    const type = el.getAttribute("data-type");
    if (!type) {
        return false;
    }
    if (type === "math-inline") {
        return el.classList.contains("vditor-wysiwyg__block") || el.classList.contains("vditor-ir__node");
    }
    if (type === "code-block" || type === "math-block" || type === "yaml-front-matter") {
        return el.classList.contains("vditor-wysiwyg__block") || el.classList.contains("vditor-ir__node");
    }
    return false;
};

const collectSanitizeBlocksInOrder = (root: ParentNode): HTMLElement[] => {
    const blocks: HTMLElement[] = [];
    const candidates = (root as HTMLElement).querySelectorAll(COPY_SANITIZE_BLOCK_SELECTOR);
    for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i] as HTMLElement;
        if (isOutermostSanitizeBlock(el)) {
            blocks.push(el);
        }
    }
    return blocks;
};

const rangeIntersectsElement = (range: Range, el: HTMLElement): boolean => {
    try {
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(el);
        return range.compareBoundaryPoints(Range.END_TO_START, nodeRange) < 0
            && range.compareBoundaryPoints(Range.START_TO_END, nodeRange) > 0;
    } catch {
        return false;
    }
};

const findLiveBlockStartIndex = (liveBlocks: HTMLElement[], range: Range | null): number => {
    if (!range || liveBlocks.length === 0) {
        return 0;
    }
    for (let i = 0; i < liveBlocks.length; i++) {
        if (rangeIntersectsElement(range, liveBlocks[i])) {
            return i;
        }
    }
    return 0;
};

const isWysiwygBlock = (block: HTMLElement) => block.closest(".vditor-wysiwyg") !== null;

const rebuildCmBlockPreForMarkdown = (
    cloneBlock: HTMLElement,
    clonePre: HTMLElement,
    languageName: string,
    codeText: string,
    isWysiwyg: boolean,
) => {
    clonePre.className = isWysiwyg ? "vditor-wysiwyg__pre" : "vditor-ir__marker--pre";
    clonePre.removeAttribute("contenteditable");
    clonePre.style.display = "";
    const cloneCode = document.createElement("code");
    cloneCode.className = languageName ? `language-${languageName}` : "";
    cloneCode.textContent = codeText;
    clonePre.replaceChildren(cloneCode);
    cloneBlock.classList.remove(CM_BLOCK_CLASS);
    const infoElement = cloneBlock.querySelector('[data-type="code-block-info"]') as HTMLElement;
    if (infoElement) {
        infoElement.textContent = Constants.ZWSP + languageName;
    }
};

const removeBlockPreviews = (block: HTMLElement) => {
    block.querySelectorAll(".vditor-wysiwyg__preview, .vditor-ir__preview").forEach((preview) => {
        preview.remove();
    });
};

const showBlockSourcePre = (block: HTMLElement) => {
    const parts = getBlockParts(block);
    if (!parts) {
        return;
    }
    parts.editPre.style.display = "block";
    parts.editPre.removeAttribute("contenteditable");
    parts.code.removeAttribute("hidden");
    parts.code.removeAttribute("aria-hidden");
    parts.code.style.display = "";
};

const syncBlockSourceFromLive = (cloneBlock: HTMLElement, liveBlock?: HTMLElement) => {
    if (!liveBlock) {
        return;
    }
    const cloneParts = getBlockParts(cloneBlock);
    const liveParts = getBlockParts(liveBlock);
    if (!cloneParts || !liveParts) {
        return;
    }
    const binding = bindings.get(liveBlock);
    const codeText = resolveCmBlockCodeText(liveBlock, binding);
    cloneParts.code.textContent = codeText;
    const language = resolveCmBlockLanguage(liveBlock, binding);
    if (language) {
        cloneParts.code.className = `language-${language}`;
    }
};

const sanitizeCmCodeBlockClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    const clonePre = cloneBlock.querySelector("pre") as HTMLElement;
    if (!clonePre) {
        return;
    }
    const binding = liveBlock ? bindings.get(liveBlock) : undefined;
    const languageName = liveBlock
        ? resolveCmBlockLanguage(liveBlock, binding)
        : resolveLanguageFromCmDom(cloneBlock);
    const codeText = liveBlock
        ? resolveCmBlockCodeText(liveBlock, binding)
        : resolveCodeTextFromCmDom(cloneBlock);
    rebuildCmBlockPreForMarkdown(cloneBlock, clonePre, languageName, codeText, isWysiwygBlock(cloneBlock));
};

const sanitizePreviewCodeBlockClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    removeBlockPreviews(cloneBlock);
    cloneBlock.querySelectorAll(".vditor-cm-chrome, .cm-editor, .vditor-mermaid-chrome, .vditor-plantuml-chrome").forEach((el) => {
        el.remove();
    });
    syncBlockSourceFromLive(cloneBlock, liveBlock);
    if (!liveBlock) {
        const parts = getBlockParts(cloneBlock);
        if (parts && !getCodeLanguageName(parts.code)) {
            const lang = resolveLanguageFromCmDom(cloneBlock);
            if (lang) {
                parts.code.className = `language-${lang}`;
            }
        }
    }
    showBlockSourcePre(cloneBlock);
    cloneBlock.classList.remove(CM_BLOCK_CLASS);
};

const sanitizeMathBlockClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    if (cloneBlock.classList.contains(CM_BLOCK_CLASS)) {
        const clonePre = cloneBlock.querySelector("pre") as HTMLElement;
        if (clonePre) {
            const binding = liveBlock ? bindings.get(liveBlock) : undefined;
            const codeText = liveBlock
                ? resolveCmBlockCodeText(liveBlock, binding)
                : resolveCodeTextFromCmDom(cloneBlock);
            rebuildCmBlockPreForMarkdown(cloneBlock, clonePre, "math", codeText, isWysiwygBlock(cloneBlock));
        }
    } else {
        removeBlockPreviews(cloneBlock);
        cloneBlock.querySelectorAll(".vditor-cm-chrome, .cm-editor").forEach((el) => {
            el.remove();
        });
        syncBlockSourceFromLive(cloneBlock, liveBlock);
        const parts = getBlockParts(cloneBlock);
        if (parts) {
            parts.code.classList.add("language-math");
            if (!parts.code.textContent && liveBlock) {
                parts.code.textContent = resolveCmBlockCodeText(liveBlock);
            }
        }
        showBlockSourcePre(cloneBlock);
        cloneBlock.classList.remove(CM_BLOCK_CLASS);
    }
};

const sanitizeInlineMathClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    cloneBlock.querySelectorAll(
        ".vditor-math-inline__cm-host, .vditor-wysiwyg__preview, .vditor-ir__preview, .cm-editor",
    ).forEach((el) => {
        el.remove();
    });
    cloneBlock.classList.remove("vditor-math-inline--editing");
    cloneBlock.removeAttribute("contenteditable");
    const cloneCode = cloneBlock.querySelector("code[data-type='math-inline']") as HTMLElement;
    if (!cloneCode) {
        return;
    }
    if (liveBlock) {
        const liveCode = liveBlock.querySelector("code[data-type='math-inline']") as HTMLElement;
        if (liveCode?.textContent) {
            cloneCode.textContent = liveCode.textContent;
        }
    }
};

const sanitizeYamlFrontMatterClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    cloneBlock.querySelectorAll(".vditor-cm-chrome, .cm-editor").forEach((el) => {
        el.remove();
    });
    const cloneCode = cloneBlock.querySelector("code[data-type='yaml-front-matter']") as HTMLElement;
    if (!cloneCode) {
        return;
    }
    if (liveBlock) {
        const liveCode = liveBlock.querySelector("code[data-type='yaml-front-matter']") as HTMLElement;
        if (liveCode?.textContent) {
            cloneCode.textContent = liveCode.textContent;
        }
    }
    cloneCode.classList.add("language-yaml");
    cloneCode.removeAttribute("hidden");
    cloneCode.style.display = "";
};

const sanitizeCopyBlockClone = (
    cloneBlock: HTMLElement,
    liveBlock: HTMLElement | undefined,
) => {
    const type = cloneBlock.getAttribute("data-type");
    switch (type) {
        case "code-block":
            if (cloneBlock.classList.contains(CM_BLOCK_CLASS)) {
                sanitizeCmCodeBlockClone(cloneBlock, liveBlock);
            } else {
                sanitizePreviewCodeBlockClone(cloneBlock, liveBlock);
            }
            break;
        case "math-block":
            sanitizeMathBlockClone(cloneBlock, liveBlock);
            break;
        case "math-inline":
            sanitizeInlineMathClone(cloneBlock, liveBlock);
            break;
        case "yaml-front-matter":
            sanitizeYamlFrontMatterClone(cloneBlock, liveBlock);
            break;
        default:
            break;
    }
};

const stripCopyFragmentChrome = (root: ParentNode) => {
    (root as HTMLElement).querySelectorAll(
        ".vditor-cm-chrome, .vditor-mermaid-chrome, .vditor-plantuml-chrome, .cm-editor",
    ).forEach((el) => {
        el.remove();
    });
    (root as HTMLElement).querySelectorAll(".vditor-math-inline--editing").forEach((container) => {
        container.classList.remove("vditor-math-inline--editing");
        container.removeAttribute("contenteditable");
    });
};

/** On copy, read the selection inside CodeMirror (the DOM Selection is usually empty) */
export const getCodeMirrorSelectionTextForCopy = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return null;
    }
    const blocks = editor.querySelectorAll(`.${CM_BLOCK_CLASS}[data-type='code-block']`);
    for (let i = 0; i < blocks.length; i++) {
        const view = getCodeMirrorView(blocks[i] as HTMLElement);
        if (!view) {
            continue;
        }
        const { from, to } = view.state.selection.main;
        if (from !== to) {
            return getCmSelectionText(view);
        }
    }
    return null;
};

/** Before copying, restore the editing DOM (CM / preview blocks / inline math etc.) so Lute converts it to Markdown correctly */
export const sanitizeCodeBlocksInCopyFragment = (
    root: ParentNode,
    editor: HTMLElement,
    range: Range | null = null,
) => {
    const cloneBlocks = collectSanitizeBlocksInOrder(root);
    const liveBlocks = collectSanitizeBlocksInOrder(editor);
    const liveStart = findLiveBlockStartIndex(liveBlocks, range);
    for (let i = 0; i < cloneBlocks.length; i++) {
        sanitizeCopyBlockClone(cloneBlocks[i], liveBlocks[liveStart + i]);
    }
    stripCopyFragmentChrome(root);
};

/** Before save/export, sync the CodeMirror document to the hidden sync code node */
export const flushCodeMirrorToSyncCode = (vditor: IVditor) => {
    const editor = getModeEditor(vditor);
    if (!editor) {
        return;
    }
    for (const block of editor.querySelectorAll(`.${CM_BLOCK_CLASS}`)) {
        const binding = bindings.get(block as HTMLElement);
        if (!binding) {
            continue;
        }
        window.clearTimeout(binding.syncTimer);
        window.clearTimeout(binding.previewTimer);
        binding.syncCode.textContent = binding.view.state.doc.toString();
    }
};

/** Sync CM state before exporting Markdown; Lute reads the CM DOM directly, no need to alter the DOM */
export const buildEditorHtmlForMarkdown = (vditor: IVditor) => {
    flushCodeMirrorToSyncCode(vditor);
    flushInlineMathToSyncCode(vditor[vditor.currentMode].element);
    flushFrontMatterYamlToSyncCode(vditor);
    const editor = getModeEditor(vditor);
    if (!editor) {
        return "";
    }
    const clone = editor.cloneNode(true) as HTMLElement;
    for (const el of clone.querySelectorAll(".vditor-cm-chrome, .cm-editor, .vditor-editor-boundary")) {
        el.remove();
    }
    for (const container of clone.querySelectorAll(".vditor-math-inline--editing")) {
        container.classList.remove("vditor-math-inline--editing");
        container.removeAttribute("contenteditable");
    }
    for (const block of clone.querySelectorAll("[data-type='code-block'], [data-type='math-block']")) {
        block.querySelectorAll(".vditor-wysiwyg__preview, .vditor-ir__preview").forEach((preview) => {
            preview.remove();
        });
        const parts = getBlockParts(block as HTMLElement);
        if (parts?.editPre) {
            parts.editPre.style.display = "block";
            parts.code.removeAttribute("hidden");
            parts.code.style.display = "";
        }
    }
    return clone.innerHTML;
};
