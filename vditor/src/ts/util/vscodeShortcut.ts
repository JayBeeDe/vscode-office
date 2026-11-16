import { isInsideCodeMirror } from "../codeBlock/codeMirrorManager";
import { highlightToolbarIR } from "../ir/highlightToolbarIR";
import { processAfterRender } from "../ir/process";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";
import { highlightToolbarWYSIWYG, moveDown, moveUp } from "../wysiwyg/highlightToolbarWYSIWYG";
import { isCtrl } from "./compatibility";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByMatchTag,
} from "./hasClosest";
import { hasClosestByHeadings, hasClosestByTag } from "./hasClosestByHeadings";
import { getEditorRange, setRangeByWbr } from "./selection";

const isTableCell = (startContainer: Node) => {
    return hasClosestByMatchTag(startContainer, "TD") || hasClosestByMatchTag(startContainer, "TH");
};

const getIrBlockElement = (range: Range): HTMLElement | false => {
    const startContainer = range.startContainer;
    if (isTableCell(startContainer)) {
        return false;
    }
    return hasClosestByTag(startContainer, "BLOCKQUOTE") as HTMLElement
        || hasClosestByMatchTag(startContainer, "LI") as HTMLElement
        || hasClosestByMatchTag(startContainer, "TABLE") as HTMLElement
        || hasClosestByAttribute(startContainer, "data-type", "code-block") as HTMLElement
        || hasClosestByAttribute(startContainer, "data-type", "math-block") as HTMLElement
        || hasClosestByHeadings(startContainer) as HTMLElement
        || hasClosestByAttribute(startContainer, "data-block", "0") as HTMLElement
        || hasClosestBlock(startContainer) as HTMLElement
        || false;
};

const canMoveBlockAmongSiblings = (element: HTMLElement, editorElement: HTMLElement) => {
    if (!element.parentElement) {
        return false;
    }
    if (element.tagName === "LI") {
        return true;
    }
    return element.parentElement.isEqualNode(editorElement);
};

const afterBlockChange = (vditor: IVditor) => {
    if (vditor.currentMode === "wysiwyg") {
        afterRenderEvent(vditor);
        highlightToolbarWYSIWYG(vditor);
    } else if (vditor.currentMode === "ir") {
        processAfterRender(vditor);
        highlightToolbarIR(vditor);
    }
};

const moveIrBlock = (range: Range, vditor: IVditor, direction: "up" | "down") => {
    const element = getIrBlockElement(range);
    if (!element) {
        return false;
    }
    const editorElement = vditor.ir.element;
    if (!canMoveBlockAmongSiblings(element, editorElement)) {
        return false;
    }

    const sibling = direction === "up" ?
        element.previousElementSibling :
        element.nextElementSibling;
    if (!sibling) {
        return false;
    }

    range.insertNode(document.createElement("wbr"));
    if (direction === "up") {
        sibling.insertAdjacentElement("beforebegin", element);
    } else {
        sibling.insertAdjacentElement("afterend", element);
    }
    setRangeByWbr(editorElement, range);
    afterBlockChange(vditor);
    return true;
};

/** VS Code shortcuts: Alt+↑/↓ move the block */
export const handleVscodeShortcut = (vditor: IVditor, event: KeyboardEvent): boolean => {
    if (event.isComposing) {
        return false;
    }

    if (isInsideCodeMirror(event.target)) {
        return false;
    }

    if (vditor.currentMode !== "wysiwyg" && vditor.currentMode !== "ir") {
        return false;
    }

    const range = getEditorRange(vditor);

    if (!isCtrl(event) && !event.shiftKey && event.altKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (vditor.currentMode === "wysiwyg") {
            if (event.key === "ArrowUp") {
                moveUp(range, vditor);
            } else {
                moveDown(range, vditor);
            }
        } else if (!moveIrBlock(range, vditor, event.key === "ArrowUp" ? "up" : "down")) {
            return false;
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    return false;
};
