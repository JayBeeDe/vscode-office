import { isInsideCodeBlockChrome } from "../codeBlock/codeMirrorManager";
import { syncBlockMarkerTop } from "../util/blockMarker";
import { execAfterRender } from "../util/fixBrowserBehavior";
import { scrollElementIntoEditorView, setSelectionFocus } from "../util/selection";

const ROOT_CLASS = "vditor-block-handle";
const INSERT_CLASS = "vditor-block-handle__insert";
const INSERT_ICON_CLASS = "vditor-block-handle__insert-icon";
const TARGET_CLASS = "vditor-block-handle-target";
const HANDLE_GAP = 4;
const HANDLE_SIZE = 20;
interface IBlockHandleState {
    root: HTMLElement;
    insertBtn: HTMLButtonElement;
    wrapper: HTMLElement;
    editorElement: HTMLElement;
    activeBlock: HTMLElement | null;
    visible: boolean;
    hideTimer: number | null;
    moveRafId: number;
    unbind?: () => void;
}

const handleMap = new WeakMap<HTMLElement, IBlockHandleState>();

const isEditingMode = (vditor: IVditor) => {
    return vditor.currentMode === "wysiwyg" || vditor.currentMode === "ir";
};

const getBlockHandleState = (vditor: IVditor) => {
    const editorElement = vditor[vditor.currentMode]?.element;
    return editorElement ? handleMap.get(editorElement) : undefined;
};

const isListElement = (element: Element | null) => {
    return !!element && (element.tagName === "UL" || element.tagName === "OL");
};

const isTocElement = (element: Element) => {
    return element.classList.contains("vditor-toc") || element.getAttribute("data-type") === "toc-block";
};

const isInsideToc = (element: Element | null) => {
    return !!element?.closest(".vditor-toc, [data-type=\"toc-block\"]");
};

const getTocBlock = (node: Node | null, editor: HTMLElement): HTMLElement | null => {
    if (!node) {
        return null;
    }
    const element = (node instanceof Element ? node : node.parentElement)
        ?.closest(".vditor-toc, [data-type=\"toc-block\"]") as HTMLElement | null;
    if (!element || !editor.contains(element) || element.parentElement !== editor || !isTocElement(element)) {
        return null;
    }
    return element;
};

const isBlockHandleElement = (element: Element | null) => {
    return !!element?.closest(`.${ROOT_CLASS}`);
};

const getHitElementAtPoint = (x: number, y: number) => {
    for (const element of document.elementsFromPoint(x, y)) {
        if (!(element instanceof Element) || isBlockHandleElement(element)) {
            continue;
        }
        return element;
    }
    return null;
};

const getInnermostListItem = (node: Node | null, editor: HTMLElement): HTMLElement | null => {
    if (!node) {
        return null;
    }
    let element = node instanceof Element ? node : node.parentElement;
    if (!element || !editor.contains(element)) {
        return null;
    }
    let innermost: HTMLElement | null = null;
    let current: Element | null = element;
    while (current && current !== editor) {
        if (current.tagName === "LI") {
            innermost = current as HTMLElement;
        }
        current = current.parentElement;
    }
    return innermost;
};

const getListItemDepth = (li: HTMLElement, editor: HTMLElement) => {
    let depth = 0;
    let current: Element | null = li.parentElement;
    while (current && current !== editor) {
        if (current.tagName === "UL" || current.tagName === "OL") {
            depth++;
        }
        current = current.parentElement;
    }
    return depth;
};

const getListItemAtPoint = (y: number, editor: HTMLElement, hitElement: Element | null) => {
    if (hitElement && editor.contains(hitElement)) {
        const innermost = getInnermostListItem(hitElement, editor);
        if (innermost) {
            const rect = innermost.getBoundingClientRect();
            if (y >= rect.top && y <= rect.bottom) {
                return innermost;
            }
        }
        let current: Element | null = hitElement;
        let inListContext = false;
        while (current && current !== editor) {
            if (current.tagName === "LI") {
                inListContext = true;
                break;
            }
            if (isListElement(current)) {
                inListContext = true;
                break;
            }
            current = current.parentElement;
        }
        if (!inListContext) {
            return null;
        }
    }
    let best: HTMLElement | null = null;
    let bestDepth = -1;
    let bestHeight = Infinity;
    for (const item of editor.querySelectorAll("li")) {
        const li = item as HTMLElement;
        if (isInsideToc(li)) {
            continue;
        }
        const rect = li.getBoundingClientRect();
        if (y < rect.top || y > rect.bottom) {
            continue;
        }
        const depth = getListItemDepth(li, editor);
        const height = rect.height;
        if (depth > bestDepth || (depth === bestDepth && height < bestHeight)) {
            bestDepth = depth;
            bestHeight = height;
            best = li;
        }
    }
    return best;
};

const getHandleBlock = (node: Node | null, editor: HTMLElement): HTMLElement | null => {
    if (!node) {
        return null;
    }
    const tocBlock = getTocBlock(node, editor);
    if (tocBlock) {
        return tocBlock;
    }
    const innermostListItem = getInnermostListItem(node, editor);
    if (innermostListItem) {
        return innermostListItem;
    }
    let element = node instanceof Element ? node : node.parentElement;
    if (!element || !editor.contains(element)) {
        return null;
    }
    while (element && element.parentElement !== editor) {
        element = element.parentElement;
    }
    if (!element || element.parentElement !== editor) {
        return null;
    }
    if (isListElement(element)) {
        return null;
    }
    return element as HTMLElement;
};

const getHandleBlockFromPoint = (x: number, y: number, editor: HTMLElement) => {
    const hitElement = getHitElementAtPoint(x, y);
    const tocBlock = getTocBlock(hitElement, editor);
    if (tocBlock) {
        return tocBlock;
    }
    const listItem = getListItemAtPoint(y, editor, hitElement);
    if (listItem) {
        return listItem;
    }
    return getHandleBlock(hitElement, editor);
};
const clearBlockHandleTarget = (block: HTMLElement | null) => {
    block?.classList.remove(TARGET_CLASS);
};

const setBlockHandleTarget = (state: IBlockHandleState, block: HTMLElement | null) => {
    if (state.activeBlock && state.activeBlock !== block) {
        clearBlockHandleTarget(state.activeBlock);
    }
    if (block) {
        block.classList.add(TARGET_CLASS);
    } else {
        clearBlockHandleTarget(state.activeBlock);
    }
};

const positionHandle = (state: IBlockHandleState, block: HTMLElement) => {
    const blockRect = block.getBoundingClientRect();
    const wrapperRect = state.wrapper.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(block).lineHeight) || 24;
    const top = blockRect.top - wrapperRect.top + Math.max(0, Math.min(lineHeight / 2 - HANDLE_SIZE / 2, 6));
    const left = blockRect.left - wrapperRect.left - (block.tagName === "LI" ? 40 : 28) - HANDLE_SIZE - HANDLE_GAP;
    syncBlockMarkerTop(block);
    state.root.style.top = `${top}px`;
    state.root.style.left = `${left}px`;
    state.root.classList.add(`${ROOT_CLASS}--visible`);
    state.visible = true;
};
const hideHandle = (state: IBlockHandleState) => {
    if (state.hideTimer !== null) {
        clearTimeout(state.hideTimer);
    }
    state.hideTimer = window.setTimeout(() => {
        state.hideTimer = null;
        clearBlockHandleTarget(state.activeBlock);
        state.activeBlock = null;
        state.visible = false;
        state.root.classList.remove(`${ROOT_CLASS}--visible`);
    }, 500);
};
const createEmptySiblingHTML = (block: HTMLElement) => {
    if (block.tagName === "LI") {
        const marker = block.getAttribute("data-marker");
        const markerAttr = marker ? ` data-marker="${marker}"` : "";
        if (block.classList.contains("vditor-task")) {
            return `<li class="vditor-task"${markerAttr}><input type="checkbox"> <wbr></li>`;
        }
        return `<li${markerAttr}><wbr></li>`;
    }
    return `<p data-block="0"><wbr>\n</p>`;
};

const focusInsertedBlock = (vditor: IVditor, block: HTMLElement) => {
    const editor = vditor[vditor.currentMode].element;
    const wbr = block.querySelector("wbr");
    const range = editor.ownerDocument.createRange();
    editor.focus({ preventScroll: true });
    if (wbr) {
        if (wbr.previousSibling?.nodeType === Node.TEXT_NODE) {
            range.setStart(wbr.previousSibling, wbr.previousSibling.textContent.length);
        } else if (wbr.nextSibling?.nodeType === Node.TEXT_NODE) {
            range.setStart(wbr.nextSibling, 0);
        } else if (wbr.nextSibling) {
            range.setStartBefore(wbr.nextSibling);
        } else {
            range.setStart(wbr.parentElement || block, 0);
        }
        wbr.remove();
    } else {
        range.selectNodeContents(block);
        range.collapse(true);
    }
    range.collapse(true);
    setSelectionFocus(range);
    scrollElementIntoEditorView(vditor, block);
};

const insertEmptyBlockAfterActiveBlock = (vditor: IVditor, state: IBlockHandleState) => {
    const block = state.activeBlock;
    if (!block || !block.isConnected || !isEditingMode(vditor)) {
        return;
    }

    block.insertAdjacentHTML("afterend", createEmptySiblingHTML(block));
    const insertedBlock = block.nextElementSibling as HTMLElement | null;
    if (!insertedBlock) {
        return;
    }

    state.activeBlock = insertedBlock;
    focusInsertedBlock(vditor, insertedBlock);
    positionHandle(state, insertedBlock);
    vditor.undo.addToUndoStack(vditor);
    execAfterRender(vditor, {
        enableAddUndoStack: false,
        enableHint: false,
        enableInput: true,
    });
};
const shouldShowHandle = (vditor: IVditor, editorElement: HTMLElement | undefined, target: EventTarget | null) => {
    if (!isEditingMode(vditor) || !editorElement || vditor[vditor.currentMode]?.element !== editorElement) {
        return false;
    }
    if (editorElement.getAttribute("contenteditable") === "false") {
        return false;
    }
    if (isInsideCodeBlockChrome(target)) {
        return false;
    }
    return true;
};

const showForBlock = (vditor: IVditor, block: HTMLElement | null) => {
    const state = getBlockHandleState(vditor);
    if (!state || !block) {
        return;
    }
    if (state.hideTimer !== null) {
        clearTimeout(state.hideTimer);
        state.hideTimer = null;
    }
    if (state.activeBlock === block) {
        return;
    }
    setBlockHandleTarget(state, block);
    state.activeBlock = block;
    positionHandle(state, block);
};

export const initBlockHandle = (vditor: IVditor, wrapper: HTMLElement, editorElement: HTMLElement) => {
    if (handleMap.has(editorElement)) {
        return;
    }

    const root = document.createElement("div");
    root.className = ROOT_CLASS;

    const insertBtn = document.createElement("button");
    insertBtn.type = "button";
    insertBtn.className = INSERT_CLASS;
    insertBtn.setAttribute("aria-label", window.VditorI18n["insert-after"] || "Insert line after");
    insertBtn.setAttribute("title", window.VditorI18n["insert-after"] || "Insert line after");
    insertBtn.innerHTML = `<svg class="${INSERT_ICON_CLASS}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path fill="currentColor" d="M5 1h2v4h4v2H7v4H5V7H1V5h4z"/></svg>`;
    root.appendChild(insertBtn);

    wrapper.insertBefore(root, wrapper.firstChild);

    const state: IBlockHandleState = {
        root,
        insertBtn,
        wrapper,
        editorElement,
        activeBlock: null,
        visible: false,
        hideTimer: null,
        moveRafId: 0,
    };
    handleMap.set(editorElement, state);

    insertBtn.addEventListener("mousedown", (event) => {
        event.preventDefault();
    });
    insertBtn.addEventListener("click", () => {
        insertEmptyBlockAfterActiveBlock(vditor, state);
    });

    let pendingMoveX = 0;
    let pendingMoveY = 0;
    let pendingMoveTarget: EventTarget | null = null;

    const onMouseMove = (event: MouseEvent) => {
        pendingMoveX = event.clientX;
        pendingMoveY = event.clientY;
        pendingMoveTarget = event.target;
        if (state.moveRafId) {
            return;
        }
        state.moveRafId = requestAnimationFrame(() => {
            state.moveRafId = 0;
            if (!shouldShowHandle(vditor, editorElement, pendingMoveTarget)) {
                return;
            }
            const block = getHandleBlockFromPoint(pendingMoveX, pendingMoveY, editorElement);
            if (block) {
                showForBlock(vditor, block);
            } else {
                hideHandle(state);
            }
        });
    };

    const onMouseLeave = (event: MouseEvent) => {
        const related = event.relatedTarget as Node | null;
        if (related && (state.root.contains(related) || state.wrapper.contains(related))) {
            return;
        }
        hideHandle(state);
    };

    const onScroll = () => {
        if (state.activeBlock) {
            positionHandle(state, state.activeBlock);
        }
    };

    const onKeyDown = () => {
        if (!state.visible) {
            return;
        }
        setBlockHandleTarget(state, null);
        state.activeBlock = null;
        state.visible = false;
        const root = state.root;
        window.setTimeout(() => {
            if (state.visible) return;
            root.classList.remove(`${ROOT_CLASS}--visible`);
        }, 500);
    };

    wrapper.addEventListener("mousemove", onMouseMove);
    wrapper.addEventListener("mouseleave", onMouseLeave);
    editorElement.addEventListener("keydown", onKeyDown, { capture: true });
    editorElement.addEventListener("scroll", onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });

    state.unbind = () => {
        if (state.moveRafId) {
            cancelAnimationFrame(state.moveRafId);
            state.moveRafId = 0;
        }
        setBlockHandleTarget(state, null);
        wrapper.removeEventListener("mousemove", onMouseMove);
        wrapper.removeEventListener("mouseleave", onMouseLeave);
        editorElement.removeEventListener("keydown", onKeyDown, { capture: true });
        editorElement.removeEventListener("scroll", onScroll);
        window.removeEventListener("scroll", onScroll);
        root.remove();
        handleMap.delete(editorElement);
    };
};

export const updateBlockHandle = (_vditor: IVditor, _target?: Node) => {
    // Block handle is shown only on mouse hover (mousemove), not on cursor/focus changes.
};

export const hideBlockHandle = (vditor: IVditor) => {
    for (const mode of ["wysiwyg", "ir"] as const) {
        const editorElement = vditor[mode]?.element;
        const state = editorElement ? handleMap.get(editorElement) : undefined;
        if (state) {
            hideHandle(state);
        }
    }
};
