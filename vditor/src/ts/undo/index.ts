import {diff_match_patch, patch_obj} from "diff-match-patch";
import {
    canRedoActiveCodeMirror,
    canUndoActiveCodeMirror,
    deactivateAllCodeMirrors,
    isInsideCodeMirror,
    redoActiveCodeMirror,
    remountCodeMirrorsAfterDomReplace,
    undoActiveCodeMirror,
} from "../codeBlock/codeMirrorManager";
import {disableToolbar, enableToolbar, hidePanel} from "../toolbar/setToolbar";
import {isFirefox, isSafari} from "../util/compatibility";
import {execAfterRender} from "../util/fixBrowserBehavior";
import {highlightToolbar} from "../util/highlightToolbar";
import {processCodeRender} from "../util/processCode";
import {setRangeByWbr, setSelectionFocus} from "../util/selection";
import {renderTocNow} from "../util/toc";
import {formatMs, logPerf} from "../util/log";

interface IUndo {
    hasUndo: boolean;
    lastText: string;
    redoStack: patch_obj[][];
    undoStack: patch_obj[][];
}

class Undo {
    private stackSize = 50;
    private dmp: diff_match_patch;
    private wysiwyg: IUndo;
    private ir: IUndo;

    constructor() {
        this.resetStack();
        this.dmp = new diff_match_patch();
    }

    public clearStack(vditor: IVditor) {
        this.resetStack();
        this.resetIcon(vditor);
    }

    public resetIcon(vditor: IVditor) {
        if (!vditor.toolbar) {
            return;
        }

        if (this[vditor.currentMode].undoStack.length > 1 || canUndoActiveCodeMirror()) {
            enableToolbar(vditor.toolbar.elements, ["undo"]);
        } else {
            disableToolbar(vditor.toolbar.elements, ["undo"]);
        }

        if (this[vditor.currentMode].redoStack.length !== 0 || canRedoActiveCodeMirror()) {
            enableToolbar(vditor.toolbar.elements, ["redo"]);
        } else {
            disableToolbar(vditor.toolbar.elements, ["redo"]);
        }
    }

    public undo(vditor: IVditor) {
        if (vditor[vditor.currentMode].element.getAttribute("contenteditable") === "false") {
            return;
        }
        if (isInsideCodeMirror(document.activeElement)) {
            undoActiveCodeMirror();
            this.resetIcon(vditor);
            return;
        }
        if (this[vditor.currentMode].undoStack.length < 2) {
            return;
        }
        const state = this[vditor.currentMode].undoStack.pop();
        if (!state) {
            return;
        }
        this[vditor.currentMode].redoStack.push(state);
        this.renderDiff(state, vditor);
        this[vditor.currentMode].hasUndo = true;
        // close the hint after an undo
        hidePanel(vditor, ["hint"]);
    }

    public redo(vditor: IVditor) {
        if (vditor[vditor.currentMode].element.getAttribute("contenteditable") === "false") {
            return;
        }
        if (isInsideCodeMirror(document.activeElement)) {
            redoActiveCodeMirror();
            this.resetIcon(vditor);
            return;
        }
        const state = this[vditor.currentMode].redoStack.pop();
        if (!state) {
            return;
        }
        this[vditor.currentMode].undoStack.push(state);
        this.renderDiff(state, vditor, true);
    }

    public recordFirstPosition(vditor: IVditor, event: KeyboardEvent) {
        if (getSelection().rangeCount === 0) {
            return;
        }
        if (this[vditor.currentMode].undoStack.length !== 1 || this[vditor.currentMode].undoStack[0].length === 0 ||
            this[vditor.currentMode].redoStack.length > 0) {
            return;
        }
        if (isFirefox() && event.key === "Backspace") {
            // in Firefox the first delete has no effect
            return;
        }
        if (isSafari()) {
            // in Safari keydown fires after input, no need to record history twice
            return;
        }
        const text = this.addCaret(vditor);
        if (text.replace("<wbr>", "").replace(" vditor-ir__node--expand", "")
            !== this[vditor.currentMode].undoStack[0][0].diffs[0][1].replace("<wbr>", "")) {
            // before anything is pushed onto the undo stack, pressing ctrl would overwrite lastText
            return;
        }
        this[vditor.currentMode].undoStack[0][0].diffs[0][1] = text;
        this[vditor.currentMode].lastText = text;
        // do not add setSelectionFocus(cloneRange); otherwise the first input breaks in Chrome on Windows
    }

    public addToUndoStack(vditor: IVditor) {
        // afterRenderEvent.ts already debounces
        const debug = vditor.options.debugger;
        const totalStart = debug ? performance.now() : 0;

        let stepStart = debug ? performance.now() : 0;
        const text = this.addCaret(vditor, true);
        const addCaretMs = debug ? performance.now() - stepStart : 0;

        stepStart = debug ? performance.now() : 0;
        const diff = this.dmp.diff_main(text, this[vditor.currentMode].lastText, true);
        const diffMainMs = debug ? performance.now() - stepStart : 0;

        stepStart = debug ? performance.now() : 0;
        const patchList = this.dmp.patch_make(text, this[vditor.currentMode].lastText, diff);
        const patchMakeMs = debug ? performance.now() - stepStart : 0;

        if (patchList.length === 0 && this[vditor.currentMode].undoStack.length > 0) {
            logPerf(debug, "[vditor undo] addToUndoStack skipped (no diff)", {
                addCaretMs: formatMs(addCaretMs),
                diffMainMs: formatMs(diffMainMs),
                patchMakeMs: formatMs(patchMakeMs),
                totalMs: formatMs(debug ? performance.now() - totalStart : 0),
            });
            return;
        }

        stepStart = debug ? performance.now() : 0;
        this[vditor.currentMode].lastText = text;
        this[vditor.currentMode].undoStack.push(patchList);
        if (this[vditor.currentMode].undoStack.length > this.stackSize) {
            this[vditor.currentMode].undoStack.shift();
        }
        if (this[vditor.currentMode].hasUndo) {
            this[vditor.currentMode].redoStack = [];
            this[vditor.currentMode].hasUndo = false;
            disableToolbar(vditor.toolbar.elements, ["redo"]);
        }

        if (this[vditor.currentMode].undoStack.length > 1) {
            enableToolbar(vditor.toolbar.elements, ["undo"]);
        }
        const stackUpdateMs = debug ? performance.now() - stepStart : 0;

        logPerf(debug, "[vditor undo] addToUndoStack", {
            addCaretMs: formatMs(addCaretMs),
            diffMainMs: formatMs(diffMainMs),
            patchMakeMs: formatMs(patchMakeMs),
            stackUpdateMs: formatMs(stackUpdateMs),
            totalMs: formatMs(debug ? performance.now() - totalStart : 0),
        });
    }

    private renderDiff(state: patch_obj[], vditor: IVditor, isRedo: boolean = false) {
        let text;
        if (isRedo) {
            const redoPatchList = this.dmp.patch_deepCopy(state).reverse();
            redoPatchList.forEach((patch) => {
                patch.diffs.forEach((diff) => {
                    diff[0] = -diff[0];
                });
            });
            text = this.dmp.patch_apply(redoPatchList, this[vditor.currentMode].lastText)[0];
        } else {
            text = this.dmp.patch_apply(state, this[vditor.currentMode].lastText)[0];
        }

        this[vditor.currentMode].lastText = text;
        if (vditor.currentMode === "wysiwyg" || vditor.currentMode === "ir") {
            deactivateAllCodeMirrors(vditor);
        }
        vditor[vditor.currentMode].element.innerHTML = text;
        if (vditor.currentMode === "wysiwyg" || vditor.currentMode === "ir") {
            remountCodeMirrorsAfterDomReplace(vditor);
        }
        vditor[vditor.currentMode].element.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='2']`)
            .forEach((blockElement: HTMLElement) => {
                processCodeRender(blockElement, vditor);
            });

        if (!vditor[vditor.currentMode].element.querySelector("wbr")) {
            // in Safari there is no caret on the first input, move it to the end manually
            const range = getSelection().getRangeAt(0);
            range.setEndBefore(vditor[vditor.currentMode].element);
            range.collapse(false);
        } else {
            setRangeByWbr(
                vditor[vditor.currentMode].element, vditor[vditor.currentMode].element.ownerDocument.createRange());
        }

        renderTocNow(vditor);

        execAfterRender(vditor, {
            enableAddUndoStack: false,
            enableHint: false,
            enableInput: true,
        });
        highlightToolbar(vditor);

        vditor[vditor.currentMode].element.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='2']`)
            .forEach((item: HTMLElement) => {
                processCodeRender(item, vditor);
            });

        this.resetIcon(vditor);
    }

    private resetStack() {
        this.ir = {
            hasUndo: false,
            lastText: "",
            redoStack: [],
            undoStack: [],
        };
        this.wysiwyg = {
            hasUndo: false,
            lastText: "",
            redoStack: [],
            undoStack: [],
        };
    }

    private addCaret(vditor: IVditor, setFocus = false) {
        let cloneRange: Range;
        if (getSelection().rangeCount !== 0 && !vditor[vditor.currentMode].element.querySelector("wbr")) {
            const range = getSelection().getRangeAt(0);
            if (vditor[vditor.currentMode].element.contains(range.startContainer) &&
                !isInsideCodeMirror(range.startContainer)) {
                cloneRange = range.cloneRange();
                const wbrElement = document.createElement("span");
                wbrElement.className = "vditor-wbr";
                range.insertNode(wbrElement);
            }
        }
        // remove math and plantuml rendering https://github.com/siyuan-note/siyuan/issues/537
        const cloneElement = vditor[vditor.currentMode].element.cloneNode(true) as HTMLElement;
        cloneElement.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='1']`)
            .forEach((item: HTMLElement) => {
                if (!item.firstElementChild) {
                    return;
                }
                if (item.firstElementChild.classList.contains("language-plantuml")) {
                    item.firstElementChild.removeAttribute("data-processed");
                    item.firstElementChild.removeAttribute("data-plantuml");
                    const sourceElement = item.previousElementSibling?.firstElementChild;
                    item.firstElementChild.innerHTML = sourceElement?.innerHTML || "";
                    item.setAttribute("data-render", "2");
                } else if (item.firstElementChild.classList.contains("language-math")) {
                    item.setAttribute("data-render", "2");
                    item.firstElementChild.textContent = item.firstElementChild.getAttribute("data-math");
                    item.firstElementChild.removeAttribute("data-math");
                }
            });
        const text = cloneElement.innerHTML;
        vditor[vditor.currentMode].element.querySelectorAll(".vditor-wbr").forEach((item) => {
            item.remove();
            // using item.outerHTML = "" causes https://github.com/Vanessa219/vditor/pull/686;
        });
        if (setFocus && cloneRange) {
            setSelectionFocus(cloneRange);
        }
        return text.replace('<span class="vditor-wbr"></span>', "<wbr>");
    }
}

export {Undo};
