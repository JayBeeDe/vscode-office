import { markOutlineEditing } from "../outline/updateOutlineActive";
import { isCmCodeBlock, isInsideCodeMirror } from "../codeBlock/codeMirrorManager";
import { input as IRInput } from "../ir/input";
import { processAfterRender } from "../ir/process";
import { uploadFiles } from "../upload/index";
import { setHeaders } from "../upload/setHeaders";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";
import { input } from "../wysiwyg/input";
import { isCtrl, isFirefox } from "./compatibility";
import {
    getTopList,
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag,
    hasTopClosestByTag,
} from "./hasClosest";
import { getLastNode } from "./hasClosest";
import { highlightToolbar } from "./highlightToolbar";
import { clearPendingHistoryTimeout, recordHistoryChange, recordHistoryPosition } from "./instantHistory";
import { matchHotKey } from "./hotKey";
import { isPasteableUrl, linkifyPastePlainText } from "./linkifyPaste";
import { routePasteClipboard } from "./pasteRouting";
import { processCodeRender, processPasteCode } from "./processCode";
import {
    getEditorRange,
    getSelectPosition,
    insertHTML,
    scrollCaretIntoEditorView,
    scrollElementIntoEditorView,
    setRangeByWbr,
    setSelectionByPosition, setSelectionFocus,
    focusTableCellContent,
} from "./selection";
import { expandMarkerWithMathSync } from "../ir/expandMarkerSync";
import { Constants } from "../constants";

const finishTableCellNavigation = (vditor: IVditor, range: Range, cell: HTMLTableCellElement, atEnd: boolean) => {
    focusTableCellContent(range, cell, atEnd);
    setSelectionFocus(range);
    expandMarkerWithMathSync(range, vditor);
};

const removePreviousTab = (range: Range, tab: string) => {
    const removeFromTextNode = (textNode: Text, endOffset: number) => {
        const text = textNode.textContent || "";
        if (endOffset < tab.length || text.slice(endOffset - tab.length, endOffset) !== tab) {
            return false;
        }
        textNode.deleteData(endOffset - tab.length, tab.length);
        range.setStart(textNode, endOffset - tab.length);
        range.collapse(true);
        return true;
    };

    const { startContainer, startOffset } = range;
    if (startContainer.nodeType === Node.TEXT_NODE) {
        if (removeFromTextNode(startContainer as Text, startOffset)) {
            return true;
        }
        if (startOffset === 0 && startContainer.previousSibling?.nodeType === Node.TEXT_NODE) {
            const previousSibling = startContainer.previousSibling as Text;
            return removeFromTextNode(previousSibling, previousSibling.textContent.length);
        }
        return false;
    }

    const previousNode = startOffset > 0 ? startContainer.childNodes[startOffset - 1] : startContainer.previousSibling;
    if (previousNode?.nodeType === Node.TEXT_NODE) {
        return removeFromTextNode(previousNode as Text, previousNode.textContent.length);
    }
    return false;
};

// https://github.com/Vanessa219/vditor/issues/508 soft keyboard cannot delete empty blocks
export const fixGSKeyBackspace = (event: KeyboardEvent, vditor: IVditor, startContainer: Node) => {
    if (event.keyCode === 229 && event.code === "" && event.key === "Unidentified") {
        const blockElement = hasClosestBlock(startContainer);
        // on mobile every punctuation key reports 299, so only handle it when deleting an empty block
        if (blockElement && blockElement.textContent.trim() === "") {
            vditor[vditor.currentMode].composingLock = true;
            return false;
        }
    }
    return true;
};

// https://github.com/Vanessa219/vditor/issues/361 typing Chinese after a code block
export const fixCJKPosition = (range: Range, vditor: IVditor, event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === "Backspace" || event.key.indexOf("Arrow") > -1
        || isCtrl(event) || event.key === "Escape" || event.shiftKey || event.altKey) {
        return;
    }
    const pLiElement = hasClosestByMatchTag(range.startContainer, "P") ||
        hasClosestByMatchTag(range.startContainer, "LI");
    if (pLiElement && getSelectPosition(pLiElement, vditor[vditor.currentMode].element, range).start === 0) {
        const zwspNode = document.createTextNode(Constants.ZWSP);
        range.insertNode(zwspNode);
        range.setStartAfter(zwspNode);
    }
};

// https://github.com/Vanessa219/vditor/issues/381 the caret cannot move down inside inline math
export const fixCursorDownInlineMath = (range: Range, key: string) => {
    if (key === "ArrowDown" || key === "ArrowUp") {
        const inlineElement = hasClosestByAttribute(range.startContainer, "data-type", "math-inline") ||
            hasClosestByAttribute(range.startContainer, "data-type", "html-entity") ||
            hasClosestByAttribute(range.startContainer, "data-type", "html-inline");
        if (inlineElement) {
            const isReadonlyHtmlInline = inlineElement.getAttribute("data-type") === "html-inline" &&
                inlineElement.getAttribute("contenteditable") === "false";
            const boundaryElement = isReadonlyHtmlInline ? inlineElement : inlineElement.parentElement;
            if (key === "ArrowDown") {
                range.setStartAfter(boundaryElement);
            }
            if (key === "ArrowUp") {
                range.setStartBefore(boundaryElement);
            }
        }
    }
};

const buildEmptyListItemHTML = (liElement: HTMLElement) => {
    const marker = liElement.getAttribute("data-marker");
    const markerAttr = marker ? ` data-marker="${marker}"` : "";
    if (liElement.classList.contains("vditor-task")) {
        return `<li class="vditor-task"${markerAttr}><input type="checkbox"> ${Constants.ZWSP}<wbr></li>`;
    }
    return `<li${markerAttr}>${Constants.ZWSP}<wbr></li>`;
};

const isEmptyParagraphBlock = (element: Element | null) => {
    return !!element
        && element.tagName === "P"
        && (element as HTMLElement).getAttribute("data-block") === "0"
        && (element as HTMLElement).textContent.trim().replace(Constants.ZWSP, "") === "";
};

const dedupeAdjacentEmptyParagraphs = (element: HTMLElement) => {
    const previousElement = element.previousElementSibling;
    const nextElement = element.nextElementSibling;

    if (isEmptyParagraphBlock(previousElement)) {
        previousElement.remove();
    }
    if (isEmptyParagraphBlock(nextElement)) {
        nextElement.remove();
    }
};

const createParagraphFromListItem = (liElement: HTMLElement) => {
    const paragraphElement = document.createElement("p");
    paragraphElement.setAttribute("data-block", "0");
    paragraphElement.innerHTML = `<wbr>${liElement.innerHTML}`;
    return paragraphElement;
};

const replaceListItemWithEmptyBlock = (liElement: HTMLElement) => {
    const listElement = liElement.parentElement;
    const beforeListElement = listElement.cloneNode(false) as HTMLElement;
    const afterListElement = listElement.cloneNode(false) as HTMLElement;
    const emptyBlockElement = document.createElement("p");
    let isAfterCurrent = false;
    let hasBefore = false;
    let hasAfter = false;

    emptyBlockElement.setAttribute("data-block", "0");
    emptyBlockElement.innerHTML = "<wbr>\n";
    Array.from(listElement.children).forEach((item) => {
        if (item.isSameNode(liElement)) {
            isAfterCurrent = true;
            return;
        }
        if (isAfterCurrent) {
            afterListElement.appendChild(item.cloneNode(true));
            hasAfter = true;
        } else {
            beforeListElement.appendChild(item.cloneNode(true));
            hasBefore = true;
        }
    });

    const fragment = document.createDocumentFragment();
    if (hasBefore) {
        fragment.appendChild(beforeListElement);
    }
    fragment.appendChild(emptyBlockElement);
    if (hasAfter) {
        fragment.appendChild(afterListElement);
    }
    listElement.replaceWith(fragment);
    dedupeAdjacentEmptyParagraphs(emptyBlockElement);
};

export const insertEmptyBlock = (vditor: IVditor, position: InsertPosition) => {
    const range = getEditorRange(vditor);
    const liElement = hasClosestByMatchTag(range.startContainer, "LI");
    if (liElement) {
        liElement.insertAdjacentHTML(position, buildEmptyListItemHTML(liElement));
        setRangeByWbr(vditor[vditor.currentMode].element, range);
        highlightToolbar(vditor);
        execAfterRender(vditor);
        return;
    }

    const blockElement = hasClosestBlock(range.startContainer);
    if (blockElement) {
        blockElement.insertAdjacentHTML(position, `<p data-block="0">${Constants.ZWSP}<wbr>\n</p>`);
        setRangeByWbr(vditor[vditor.currentMode].element, range);
        highlightToolbar(vditor);
        execAfterRender(vditor);
    }
};

export const isFirstCell = (cellElement: HTMLElement) => {
    const tableElement = hasClosestByMatchTag(cellElement, "TABLE") as HTMLTableElement;
    if (tableElement && tableElement.rows[0].cells[0].isSameNode(cellElement)) {
        return tableElement;
    }
    return false;
};

export const isLastCell = (cellElement: HTMLElement) => {
    const tableElement = hasClosestByMatchTag(cellElement, "TABLE") as HTMLTableElement;
    if (tableElement && tableElement.lastElementChild.lastElementChild.lastElementChild.isSameNode(cellElement)) {
        return tableElement;
    }
    return false;
};

// Move the caret into the previous table
const goPreviousCell = (cellElement: HTMLElement, range: Range, isSelected = true) => {
    let previousElement = cellElement.previousElementSibling;
    if (!previousElement) {
        if (cellElement.parentElement.previousElementSibling) {
            previousElement = cellElement.parentElement.previousElementSibling.lastElementChild;
        } else if (cellElement.parentElement.parentElement.tagName === "TBODY" &&
            cellElement.parentElement.parentElement.previousElementSibling) {
            previousElement = cellElement.parentElement
                .parentElement.previousElementSibling.lastElementChild.lastElementChild;
        } else {
            previousElement = null;
        }
    }
    if (previousElement) {
        focusTableCellContent(range, previousElement as HTMLTableCellElement, !isSelected);
        setSelectionFocus(range);
    }
    return previousElement;
};

export const insertAfterBlock = (vditor: IVditor, event: KeyboardEvent, range: Range, element: HTMLElement,
    blockElement: HTMLElement) => {
    const position = getSelectPosition(element, vditor[vditor.currentMode].element, range);
    if ((event.key === "ArrowDown" && element.textContent.trimRight().substr(position.start).indexOf("\n") === -1) ||
        (event.key === "ArrowRight" && position.start >= element.textContent.trimRight().length)) {
        const nextElement = blockElement.nextElementSibling;
        if (!nextElement ||
            (nextElement && (nextElement.tagName === "TABLE" || nextElement.getAttribute("data-type")))) {
            blockElement.insertAdjacentHTML("afterend",
                `<p data-block="0">${Constants.ZWSP}<wbr></p>`);
            setRangeByWbr(vditor[vditor.currentMode].element, range);
        } else {
            range.selectNodeContents(nextElement);
            range.collapse(true);
            setSelectionFocus(range);
        }
        event.preventDefault();
        return true;
    }
    return false;
};

export const insertBeforeBlock = (vditor: IVditor, event: KeyboardEvent, range: Range, element: HTMLElement,
    blockElement: HTMLElement) => {
    const position = getSelectPosition(element, vditor[vditor.currentMode].element, range);
    if ((event.key === "ArrowUp" && element.textContent.substr(0, position.start).indexOf("\n") === -1) ||
        ((event.key === "ArrowLeft" || (event.key === "Backspace" && range.toString() === "")) &&
            position.start === 0)) {
        const previousElement = blockElement.previousElementSibling;
        // table || code
        if (!previousElement ||
            (previousElement && (previousElement.tagName === "TABLE" || previousElement.getAttribute("data-type")))) {
            blockElement.insertAdjacentHTML("beforebegin",
                `<p data-block="0">${Constants.ZWSP}<wbr></p>`);
            setRangeByWbr(vditor[vditor.currentMode].element, range);
        } else {
            range.selectNodeContents(previousElement);
            range.collapse(false);
            setSelectionFocus(range);
        }
        event.preventDefault();
        return true;
    }
    return false;
};

export const listToggle = (vditor: IVditor, range: Range, type: string, cancel = true) => {
    const itemElement = hasClosestByMatchTag(range.startContainer, "LI");
    vditor[vditor.currentMode].element.querySelectorAll("wbr").forEach((wbr) => {
        wbr.remove();
    });
    range.insertNode(document.createElement("wbr"));

    if (cancel && itemElement) {
        // Remove
        let pHTML = "";
        for (let i = 0; i < itemElement.parentElement.childElementCount; i++) {
            const inputElement = itemElement.parentElement.children[i].querySelector("input");
            if (inputElement) {
                inputElement.remove();
            }
            pHTML += `<p data-block="0">${itemElement.parentElement.children[i].innerHTML.trimLeft()}</p>`;
        }
        itemElement.parentElement.insertAdjacentHTML("beforebegin", pHTML);
        itemElement.parentElement.remove();
    } else {
        if (!itemElement) {
            // Add
            let blockElement = hasClosestByAttribute(range.startContainer, "data-block", "0");
            if (!blockElement) {
                vditor[vditor.currentMode].element.querySelector("wbr").remove();
                blockElement = vditor[vditor.currentMode].element.querySelector("p");
                blockElement.innerHTML = "<wbr>";
            }
            if (type === "check") {
                blockElement.insertAdjacentHTML("beforebegin",
                    `<ul data-block="0"><li class="vditor-task"><input type="checkbox" /> ${blockElement.innerHTML}</li></ul>`);
                blockElement.remove();
            } else if (type === "list") {
                blockElement.insertAdjacentHTML("beforebegin",
                    `<ul data-block="0"><li>${blockElement.innerHTML}</li></ul>`);
                blockElement.remove();
            } else if (type === "ordered-list") {
                blockElement.insertAdjacentHTML("beforebegin",
                    `<ol data-block="0"><li>${blockElement.innerHTML}</li></ol>`);
                blockElement.remove();
            }
        } else {
            // Switch
            if (type === "check") {
                itemElement.parentElement.querySelectorAll("li").forEach((item) => {
                    item.insertAdjacentHTML("afterbegin",
                        `<input type="checkbox" />${item.textContent.indexOf(" ") === 0 ? "" : " "}`);
                    item.classList.add("vditor-task");
                });
            } else {
                if (itemElement.querySelector("input")) {
                    itemElement.parentElement.querySelectorAll("li").forEach((item) => {
                        item.querySelector("input").remove();
                        item.classList.remove("vditor-task");
                    });
                }
                let element;
                if (type === "list") {
                    element = document.createElement("ul");
                    element.setAttribute("data-marker", "*");
                } else {
                    element = document.createElement("ol");
                    element.setAttribute("data-marker", "1.");
                }
                element.setAttribute("data-block", "0");
                element.setAttribute("data-tight", itemElement.parentElement.getAttribute("data-tight"));
                element.innerHTML = itemElement.parentElement.innerHTML;
                itemElement.parentElement.parentNode.replaceChild(element, itemElement.parentElement);
            }
        }
    }
};

export const listIndent = (vditor: IVditor, liElement: HTMLElement, range: Range) => {
    const previousElement = liElement.previousElementSibling;
    if (liElement && previousElement) {
        const liElements: HTMLElement[] = [liElement];
        Array.from(range.cloneContents().children).forEach((item, index) => {
            if (item.nodeType !== 3 && liElement && item.textContent.trim() !== ""
                && liElement.getAttribute("data-node-id") === item.getAttribute("data-node-id")) {
                if (index !== 0) {
                    liElements.push(liElement);
                }
                liElement = liElement.nextElementSibling as HTMLElement;
            }
        });

        vditor[vditor.currentMode].element.querySelectorAll("wbr").forEach((wbr) => {
            wbr.remove();
        });
        range.insertNode(document.createElement("wbr"));
        const liParentElement = previousElement.parentElement;

        let liHTML = "";
        liElements.forEach((item: HTMLElement) => {
            let marker = item.getAttribute("data-marker");
            if (marker.length !== 1) {
                marker = `1${marker.slice(-1)}`;
            }
            liHTML += `<li data-node-id="${item.getAttribute("data-node-id")}" data-marker="${marker}">${item.innerHTML}</li>`;
            item.remove();
        });
        previousElement.insertAdjacentHTML("beforeend",
            `<${liParentElement.tagName} data-block="0">${liHTML}</${liParentElement.tagName}>`);

        if (vditor.currentMode === "wysiwyg") {
            liParentElement.outerHTML = vditor.lute.SpinVditorDOM(liParentElement.outerHTML);
        } else {
            liParentElement.outerHTML = vditor.lute.SpinVditorIRDOM(liParentElement.outerHTML);
        }

        setRangeByWbr(vditor[vditor.currentMode].element, range);
        const tempTopListElement = getTopList(range.startContainer);
        if (tempTopListElement) {
            tempTopListElement.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='2']`)
                .forEach((item: HTMLElement) => {
                    processCodeRender(item, vditor);
                    if (vditor.currentMode === "wysiwyg" &&
                        !isCmCodeBlock(item.parentElement as HTMLElement)) {
                        item.previousElementSibling.setAttribute("style", "display:none");
                    }
                });
        }
        execAfterRender(vditor);
        highlightToolbar(vditor);
    } else {
        vditor[vditor.currentMode].element.focus();
    }
};

export const listOutdent = (vditor: IVditor, liElement: HTMLElement, range: Range, topListElement: HTMLElement) => {
    const liParentLiElement = hasClosestByMatchTag(liElement.parentElement, "LI");
    if (liParentLiElement) {
        vditor[vditor.currentMode].element.querySelectorAll("wbr").forEach((wbr) => {
            wbr.remove();
        });
        range.insertNode(document.createElement("wbr"));

        const liParentElement = liElement.parentElement;
        const liParentAfterElement = liParentElement.cloneNode() as HTMLElement;
        const liElements: HTMLElement[] = [liElement];
        Array.from(range.cloneContents().children).forEach((item, index) => {
            if (item.nodeType !== 3 && liElement && item.textContent.trim() !== "" &&
                liElement.getAttribute("data-node-id") === item.getAttribute("data-node-id")) {
                if (index !== 0) {
                    liElements.push(liElement);
                }
                liElement = liElement.nextElementSibling as HTMLElement;
            }
        });
        let isMatch = false;
        let afterHTML = "";
        liParentElement.querySelectorAll("li").forEach((item) => {
            if (isMatch) {
                afterHTML += item.outerHTML;
                if (!item.nextElementSibling && !item.previousElementSibling) {
                    item.parentElement.remove();
                } else {
                    item.remove();
                }
            }
            if (item.isSameNode(liElements[liElements.length - 1])) {
                isMatch = true;
            }
        });

        liElements.reverse().forEach((item) => {
            liParentLiElement.insertAdjacentElement("afterend", item);
        });

        if (afterHTML) {
            liParentAfterElement.innerHTML = afterHTML;
            liElements[0].insertAdjacentElement("beforeend", liParentAfterElement);
        }

        if (vditor.currentMode === "wysiwyg") {
            topListElement.outerHTML = vditor.lute.SpinVditorDOM(topListElement.outerHTML);
        } else {
            topListElement.outerHTML = vditor.lute.SpinVditorIRDOM(topListElement.outerHTML);
        }

        setRangeByWbr(vditor[vditor.currentMode].element, range);
        const tempTopListElement = getTopList(range.startContainer);
        if (tempTopListElement) {
            tempTopListElement.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='2']`)
                .forEach((item: HTMLElement) => {
                    processCodeRender(item, vditor);
                    if (vditor.currentMode === "wysiwyg" &&
                        !isCmCodeBlock(item.parentElement as HTMLElement)) {
                        item.previousElementSibling.setAttribute("style", "display:none");
                    }
                });
        }
        execAfterRender(vditor);
        highlightToolbar(vditor);
    } else {
        vditor[vditor.currentMode].element.focus();
    }
};

export const setTableAlign = (tableElement: HTMLTableElement, type: string) => {
    const cell = getSelection().getRangeAt(0).startContainer.parentElement;

    const columnCnt = tableElement.rows[0].cells.length;
    const rowCnt = tableElement.rows.length;
    let currentColumn = 0;

    for (let i = 0; i < rowCnt; i++) {
        for (let j = 0; j < columnCnt; j++) {
            if (tableElement.rows[i].cells[j].isSameNode(cell)) {
                currentColumn = j;
                break;
            }
        }
    }
    for (let k = 0; k < rowCnt; k++) {
        tableElement.rows[k].cells[currentColumn].setAttribute("align", type);
    }
};

export const isHrMD = (text: string) => {
    // - _ *
    const marker = text.trimRight().split("\n").pop();
    if (marker === "") {
        return false;
    }
    if (marker.replace(/ |-/g, "") === ""
        || marker.replace(/ |_/g, "") === ""
        || marker.replace(/ |\*/g, "") === "") {
        if (marker.replace(/ /g, "").length > 2) {
            if (marker.indexOf("-") > -1 && marker.trimLeft().indexOf(" ") === -1
                && text.trimRight().split("\n").length > 1) {
                // matches a heading
                return false;
            }
            if (marker.indexOf("    ") === 0 || marker.indexOf("\t") === 0) {
                // code block
                return false;
            }
            return true;
        }
        return false;
    }
    return false;
};

export const fixHeadingEnter = (vditor: IVditor, range: Range, headingElement: HTMLElement) => {
    const editor = vditor.wysiwyg.element;
    const atHeadingStart = getSelectPosition(headingElement, editor, range).start === 0;

    const afterRange = range.cloneRange();
    afterRange.selectNodeContents(headingElement);
    afterRange.setStart(range.startContainer, range.startOffset);
    const afterFragment = afterRange.extractContents();

    const isEmpty = (text: string) => !text || text.replace(Constants.ZWSP, "").trim() === "";
    const headingEmpty = isEmpty(headingElement.textContent);
    const afterEmpty = isEmpty(afterFragment.textContent);

    const scrollAfterEnter = (scrollTarget?: HTMLElement) => {
        requestAnimationFrame(() => {
            if (scrollTarget) {
                scrollElementIntoEditorView(vditor, scrollTarget);
            }
            scrollCaretIntoEditorView(vditor, range);
        });
    };

    if (headingEmpty && afterEmpty) {
        headingElement.outerHTML = `<p data-block="0"><wbr>\n</p>`;
        setRangeByWbr(editor, range);
        scrollAfterEnter();
        return;
    }

    // Enter at the start of a heading: insert an empty paragraph above and keep the caret at the start of the heading
    if (atHeadingStart && headingEmpty) {
        const pElement = document.createElement("p");
        pElement.setAttribute("data-block", "0");
        pElement.textContent = `${Constants.ZWSP}\n`;
        const newHeading = document.createElement(headingElement.tagName);
        newHeading.setAttribute("data-block", "0");
        newHeading.appendChild(afterFragment);
        headingElement.parentElement.insertBefore(pElement, headingElement);
        headingElement.parentElement.insertBefore(newHeading, headingElement);
        headingElement.remove();
        newHeading.insertAdjacentElement("afterbegin", document.createElement("wbr"));
        setRangeByWbr(newHeading, range);
        scrollAfterEnter(pElement);
        return;
    }

    const pElement = document.createElement("p");
    pElement.setAttribute("data-block", "0");
    if (afterEmpty) {
        pElement.innerHTML = `<wbr>\n`;
    } else {
        pElement.appendChild(afterFragment);
        pElement.insertAdjacentElement("afterbegin", document.createElement("wbr"));
    }
    headingElement.insertAdjacentElement("afterend", pElement);
    setRangeByWbr(pElement, range);
    scrollAfterEnter();
};

export const splitHeadingOnNewline = (vditor: IVditor, headingElement: HTMLElement) => {
    if (!headingElement.textContent || !headingElement.textContent.includes("\n")) {
        return false;
    }
    const parts = headingElement.textContent.split("\n");
    headingElement.textContent = parts[0];

    let refElement: HTMLElement = headingElement;
    for (let i = 1; i < parts.length; i++) {
        const pElement = document.createElement("p");
        pElement.setAttribute("data-block", "0");
        pElement.textContent = parts[i] === "" ? "\n" : parts[i];
        refElement.insertAdjacentElement("afterend", pElement);
        refElement = pElement;
    }
    return true;
};

export const isHeadingMD = (text: string) => {
    // - =
    const textArray = text.trimRight().split("\n");
    text = textArray.pop();

    if (text.indexOf("    ") === 0 || text.indexOf("\t") === 0) {
        return false;
    }

    text = text.trimLeft();
    if (text === "" || textArray.length === 0) {
        return false;
    }
    if (text.replace(/-/g, "") === ""
        || text.replace(/=/g, "") === "") {
        return true;
    }
    return false;
};

export const execAfterRender = (vditor: IVditor, options = {
    enableAddUndoStack: true,
    enableHint: false,
    enableInput: true,
}) => {
    if (vditor.currentMode === "wysiwyg") {
        afterRenderEvent(vditor, options);
    } else if (vditor.currentMode === "ir") {
        processAfterRender(vditor, options);
    }
};

export const fixList = (range: Range, vditor: IVditor, pElement: HTMLElement | false, event: KeyboardEvent) => {
    const startContainer = range.startContainer;
    const liElement = hasClosestByMatchTag(startContainer, "LI");
    if (liElement) {
        if (!isCtrl(event) && !event.altKey && event.key === "Enter" &&
            // fix: when an li has several P elements, a line break in the first P creates a new li below
            (!event.shiftKey && pElement && liElement.contains(pElement) && pElement.nextElementSibling)) {
            if (liElement && !liElement.textContent.endsWith("\n")) {
                // the li must end with \n
                liElement.insertAdjacentText("beforeend", "\n");
            }
            range.insertNode(document.createTextNode("\n\n"));
            range.collapse(false);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        if (!isCtrl(event) && !event.shiftKey && !event.altKey && event.key === "Backspace" &&
            !liElement.previousElementSibling && range.toString() === "" &&
            getSelectPosition(liElement, vditor[vditor.currentMode].element, range).start === 0) {
            // the li element cannot be deleted when the caret is between the bullet and the first character
            const paragraphElement = createParagraphFromListItem(liElement);
            if (liElement.nextElementSibling) {
                liElement.parentElement.insertAdjacentElement("beforebegin", paragraphElement);
                liElement.remove();
            } else {
                liElement.parentElement.replaceWith(paragraphElement);
            }
            dedupeAdjacentEmptyParagraphs(paragraphElement);
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            recordHistoryChange(vditor);
            event.preventDefault();
            return true;
        }

        // after deleting an empty list item, align with the parent paragraph
        if (event.key === "Backspace" &&
            !event.shiftKey && !event.altKey &&
            liElement.textContent.trim().replace(Constants.ZWSP, "") === "" &&
            range.toString() === "" && liElement.previousElementSibling?.tagName === "LI") {
            recordHistoryPosition(vditor);
            replaceListItemWithEmptyBlock(liElement);
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            recordHistoryChange(vditor);
            event.preventDefault();
            return true;
        }

        if (!isCtrl(event) && !event.altKey && event.key === "Tab") {
            // when the caret is at the first/zeroth character, tab indents the list
            let isFirst = false;
            if (range.startOffset === 0
                && ((startContainer.nodeType === 3 && !startContainer.previousSibling)
                    || (startContainer.nodeType !== 3 && startContainer.nodeName === "LI"))) {
                // ordered/unordered list
                isFirst = true;
            } else if (liElement.classList.contains("vditor-task") && range.startOffset === 1
                && startContainer.previousSibling.nodeType !== 3
                && (startContainer.previousSibling as HTMLElement).tagName === "INPUT") {
                // task list
                isFirst = true;
            }

            if (isFirst || range.toString() !== "") {
                if (event.shiftKey) {
                    listOutdent(vditor, liElement, range, liElement.parentElement);
                } else {
                    listIndent(vditor, liElement, range);
                }
                event.preventDefault();
                return true;
            }
        }
    }
    return false;
};

// tab handling: block code render, table; tab at the first character of a list item is handled separately above
export const fixTab = (vditor: IVditor, range: Range, event: KeyboardEvent) => {
    if (vditor.options.tab && event.key === "Tab") {
        if (event.shiftKey) {
            removePreviousTab(range, vditor.options.tab);
        } else {
            if (range.toString() === "") {
                range.insertNode(document.createTextNode(vditor.options.tab));
                range.collapse(false);
            } else {
                range.extractContents();
                range.insertNode(document.createTextNode(vditor.options.tab));
                range.collapse(false);
            }
        }
        setSelectionFocus(range);
        execAfterRender(vditor);
        event.preventDefault();
        return true;
    }
};

export const fixMarkdown = (event: KeyboardEvent, vditor: IVditor, pElement: HTMLElement | false, range: Range) => {
    if (!pElement) {
        return;
    }
    if (!isCtrl(event) && !event.altKey && event.key === "Enter") {
        const pText = String.raw`${pElement.textContent}`.replace(/\\\|/g, "").trim();
        const pTextList = pText.split("|");
        if (pText.startsWith("|") && pText.endsWith("|") && pTextList.length > 3) {
            // table autocompletion
            let tableHeaderMD = pTextList.map(() => "---").join("|");
            tableHeaderMD =
                pElement.textContent + "\n" + tableHeaderMD.substring(3, tableHeaderMD.length - 3) + "\n|<wbr>";
            pElement.outerHTML = vditor.lute.SpinVditorDOM(tableHeaderMD);
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        // hr rendering
        if (isHrMD(pElement.innerHTML) && pElement.previousElementSibling) {
            // content before the hr after a soft line break
            let pInnerHTML = "";
            const innerHTMLList = pElement.innerHTML.trimRight().split("\n");
            if (innerHTMLList.length > 1) {
                innerHTMLList.pop();
                pInnerHTML = `<p data-block="0">${innerHTMLList.join("\n")}</p>`;
            }

            pElement.insertAdjacentHTML("afterend",
                `${pInnerHTML}<hr data-block="0"><p data-block="0"><wbr>\n</p>`);
            pElement.remove();
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        if (isHeadingMD(pElement.innerHTML)) {
            // heading rendering
            if (vditor.currentMode === "wysiwyg") {
                pElement.outerHTML = vditor.lute.SpinVditorDOM(pElement.innerHTML + '<p data-block="0"><wbr>\n</p>');
            } else {
                pElement.outerHTML = vditor.lute.SpinVditorIRDOM(pElement.innerHTML + '<p data-block="0"><wbr>\n</p>');
            }
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }
    }

    // soft line breaks get split https://github.com/Vanessa219/vditor/issues/220
    if (range.collapsed && pElement.previousElementSibling && event.key === "Backspace" &&
        !isCtrl(event) && !event.altKey && !event.shiftKey &&
        pElement.textContent.trimRight().split("\n").length > 1 &&
        getSelectPosition(pElement, vditor[vditor.currentMode].element, range).start === 0) {
        const lastElement = getLastNode(pElement.previousElementSibling) as HTMLElement;
        if (!lastElement.textContent.endsWith("\n")) {
            lastElement.textContent = lastElement.textContent + "\n";
        }
        lastElement.parentElement.insertAdjacentHTML("beforeend", `<wbr>${pElement.innerHTML}`);
        pElement.remove();
        setRangeByWbr(vditor[vditor.currentMode].element, range);
        return false;
    }
    return false;
};

export const insertRow = (vditor: IVditor, range: Range, cellElement: HTMLElement) => {
    let rowHTML = "";
    for (let m = 0; m < cellElement.parentElement.childElementCount; m++) {
        rowHTML += `<td align="${cellElement.parentElement.children[m].getAttribute("align")}"> </td>`;
    }
    if (cellElement.tagName === "TH") {
        cellElement.parentElement.parentElement.insertAdjacentHTML("afterend",
            `<tbody><tr>${rowHTML}</tr></tbody>`);
    } else {
        cellElement.parentElement.insertAdjacentHTML("afterend", `<tr>${rowHTML}</tr>`);
    }
    execAfterRender(vditor);
};

export const insertRowAbove = (vditor: IVditor, range: Range, cellElement: HTMLElement) => {
    let rowHTML = "";
    for (let m = 0; m < cellElement.parentElement.childElementCount; m++) {
        if (cellElement.tagName === "TH") {
            rowHTML += `<th align="${cellElement.parentElement.children[m].getAttribute("align")}"> </th>`;
        } else {
            rowHTML += `<td align="${cellElement.parentElement.children[m].getAttribute("align")}"> </td>`;
        }
    }
    if (cellElement.tagName === "TH") {
        cellElement.parentElement.parentElement.insertAdjacentHTML("beforebegin", `<thead><tr>${rowHTML}</tr></thead>`);

        range.insertNode(document.createElement("wbr"));
        const theadHTML = cellElement.parentElement.innerHTML.replace(/<th>/g, "<td>").replace(/<\/th>/g, "</td>");
        cellElement.parentElement.parentElement.nextElementSibling.insertAdjacentHTML("afterbegin", theadHTML);

        cellElement.parentElement.parentElement.remove();
        setRangeByWbr(vditor.ir.element, range);
    } else {
        cellElement.parentElement.insertAdjacentHTML("beforebegin", `<tr>${rowHTML}</tr>`);
    }
    execAfterRender(vditor);
};

export const insertColumn =
    (vditor: IVditor, tableElement: HTMLTableElement, cellElement: HTMLElement, type: InsertPosition = "afterend") => {
        let index = 0;
        let previousElement = cellElement.previousElementSibling;
        while (previousElement) {
            index++;
            previousElement = previousElement.previousElementSibling;
        }
        for (let i = 0; i < tableElement.rows.length; i++) {
            if (i === 0) {
                tableElement.rows[i].cells[index].insertAdjacentHTML(type, "<th> </th>");
            } else {
                tableElement.rows[i].cells[index].insertAdjacentHTML(type, "<td> </td>");
            }
        }
        execAfterRender(vditor);
    };
export const deleteRow = (vditor: IVditor, range: Range, cellElement: HTMLElement) => {
    if (cellElement.tagName === "TD") {
        const tbodyElement = cellElement.parentElement.parentElement;
        if (cellElement.parentElement.previousElementSibling) {
            range.selectNodeContents(cellElement.parentElement.previousElementSibling.lastElementChild);
        } else {
            range.selectNodeContents(tbodyElement.previousElementSibling.lastElementChild.lastElementChild);
        }

        if (tbodyElement.childElementCount === 1) {
            tbodyElement.remove();
        } else {
            cellElement.parentElement.remove();
        }

        range.collapse(false);
        setSelectionFocus(range);
        execAfterRender(vditor);
    }
};

export const deleteColumn =
    (vditor: IVditor, range: Range, tableElement: HTMLTableElement, cellElement: HTMLElement) => {
        let index = 0;
        let previousElement = cellElement.previousElementSibling;
        while (previousElement) {
            index++;
            previousElement = previousElement.previousElementSibling;
        }
        if (cellElement.previousElementSibling || cellElement.nextElementSibling) {
            range.selectNodeContents(cellElement.previousElementSibling || cellElement.nextElementSibling);
            range.collapse(true);
        }
        for (let i = 0; i < tableElement.rows.length; i++) {
            const cells = tableElement.rows[i].cells;
            if (cells.length === 1) {
                tableElement.remove();
                highlightToolbar(vditor);
                break;
            }
            cells[index].remove();
        }
        setSelectionFocus(range);
        execAfterRender(vditor);
    };
export const fixTable = (vditor: IVditor, event: KeyboardEvent, range: Range) => {
    const startContainer = range.startContainer;
    const cellElement = hasClosestByMatchTag(startContainer, "TD") ||
        hasClosestByMatchTag(startContainer, "TH");
    if (cellElement) {
        // line break or soft line break: add a br in the cell
        if (!isCtrl(event) && !event.altKey && event.key === "Enter") {
            if (!cellElement.lastElementChild ||
                (cellElement.lastElementChild && (!cellElement.lastElementChild.isSameNode(cellElement.lastChild) ||
                    cellElement.lastElementChild.tagName !== "BR"))) {
                cellElement.insertAdjacentHTML("beforeend", "<br>");
            }
            const brElement = document.createElement("br");
            range.insertNode(brElement);
            range.setStartAfter(brElement);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        // tab: move the caret to the next cell
        if (event.key === "Tab") {
            if (event.shiftKey) {
                // shift + tab: move the caret to the previous cell
                goPreviousCell(cellElement, range);
                expandMarkerWithMathSync(range, vditor);
                event.preventDefault();
                return true;
            }

            let nextElement = cellElement.nextElementSibling;
            if (!nextElement) {
                if (cellElement.parentElement.nextElementSibling) {
                    nextElement = cellElement.parentElement.nextElementSibling.firstElementChild;
                } else if (cellElement.parentElement.parentElement.tagName === "THEAD" &&
                    cellElement.parentElement.parentElement.nextElementSibling) {
                    nextElement =
                        cellElement.parentElement.parentElement.nextElementSibling.firstElementChild.firstElementChild;
                } else {
                    nextElement = null;
                }
            }
            if (nextElement) {
                finishTableCellNavigation(vditor, range, nextElement as HTMLTableCellElement, false);
            }
            event.preventDefault();
            return true;
        }

        const tableElement = cellElement.parentElement.parentElement.parentElement as HTMLTableElement;
        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (cellElement.tagName === "TH") {
                if (tableElement.previousElementSibling) {
                    range.selectNodeContents(tableElement.previousElementSibling);
                    range.collapse(false);
                    setSelectionFocus(range);
                } else {
                    insertEmptyBlock(vditor, "beforebegin");
                }
                return true;
            }

            let m = 0;
            const trElement = cellElement.parentElement as HTMLTableRowElement;
            for (; m < trElement.cells.length; m++) {
                if (trElement.cells[m].isSameNode(cellElement)) {
                    break;
                }
            }

            let previousElement = trElement.previousElementSibling as HTMLTableRowElement;
            if (!previousElement) {
                previousElement = trElement.parentElement.previousElementSibling.firstChild as HTMLTableRowElement;
            }
            finishTableCellNavigation(vditor, range, previousElement.cells[m], true);
            return true;
        }

        if (event.key === "ArrowDown") {
            event.preventDefault();
            const trElement = cellElement.parentElement as HTMLTableRowElement;
            if (!trElement.nextElementSibling && cellElement.tagName === "TD") {
                if (tableElement.nextElementSibling) {
                    range.selectNodeContents(tableElement.nextElementSibling);
                    range.collapse(true);
                    setSelectionFocus(range);
                } else {
                    insertEmptyBlock(vditor, "afterend");
                }
                return true;
            }

            let m = 0;
            for (; m < trElement.cells.length; m++) {
                if (trElement.cells[m].isSameNode(cellElement)) {
                    break;
                }
            }

            let nextElement = trElement.nextElementSibling as HTMLTableRowElement;
            if (!nextElement) {
                nextElement = trElement.parentElement.nextElementSibling.firstChild as HTMLTableRowElement;
            }
            finishTableCellNavigation(vditor, range, nextElement.cells[m], false);
            return true;
        }

        // focus row input, only wysiwyg
        if (vditor.currentMode === "wysiwyg" &&
            !isCtrl(event) && event.key === "Enter" && !event.shiftKey && event.altKey) {
            const inputElement = (vditor.wysiwyg.popover.querySelector(".vditor-input") as HTMLInputElement);
            inputElement.focus();
            inputElement.select();
            event.preventDefault();
            return true;
        }

        // Backspace: move the caret to the previous cell
        if (!isCtrl(event) && !event.shiftKey && !event.altKey && event.key === "Backspace"
            && range.startOffset === 0 && range.toString() === "") {
            const previousCellElement = goPreviousCell(cellElement, range, false);
            if (previousCellElement) {
                expandMarkerWithMathSync(range, vditor);
            } else if (tableElement) {
                if (tableElement.textContent.trim() === "") {
                    tableElement.outerHTML = `<p data-block="0"><wbr>\n</p>`;
                    setRangeByWbr(vditor[vditor.currentMode].element, range);
                } else {
                    range.setStartBefore(tableElement);
                    range.collapse(true);
                }
                execAfterRender(vditor);
            }
            event.preventDefault();
            return true;
        }
        // insert a new row above
        if (matchHotKey("⇧⌘F", event)) {
            insertRowAbove(vditor, range, cellElement);
            event.preventDefault();
            return true;
        }

        // insert a new row below https://github.com/Vanessa219/vditor/issues/46
        if (matchHotKey("⌘=", event)) {
            insertRow(vditor, range, cellElement);
            event.preventDefault();
            return true;
        }

        // insert a new column on the left
        if (matchHotKey("⇧⌘G", event)) {
            insertColumn(vditor, tableElement, cellElement, "beforebegin");
            event.preventDefault();
            return true;
        }

        // insert a new column on the right
        if (matchHotKey("⇧⌘=", event)) {
            insertColumn(vditor, tableElement, cellElement);
            event.preventDefault();
            return true;
        }

        // delete the current row
        if (matchHotKey("⌘-", event)) {
            deleteRow(vditor, range, cellElement);
            event.preventDefault();
            return true;
        }

        // delete the current column
        if (matchHotKey("⇧⌘-", event)) {
            deleteColumn(vditor, range, tableElement, cellElement);
            event.preventDefault();
            return true;
        }

        // align left
        if (matchHotKey("⇧⌘L", event)) {
            if (vditor.currentMode === "ir") {
                setTableAlign(tableElement, "left");
                execAfterRender(vditor);
                event.preventDefault();
                return true;
            } else {
                const itemElement: HTMLElement = vditor.wysiwyg.popover.querySelector('[data-type="left"]');
                if (itemElement) {
                    itemElement.click();
                    event.preventDefault();
                    return true;
                }
            }
        }

        // align center
        if (matchHotKey("⇧⌘C", event)) {
            if (vditor.currentMode === "ir") {
                setTableAlign(tableElement, "center");
                execAfterRender(vditor);
                event.preventDefault();
                return true;
            } else {
                const itemElement: HTMLElement = vditor.wysiwyg.popover.querySelector('[data-type="center"]');
                if (itemElement) {
                    itemElement.click();
                    event.preventDefault();
                    return true;
                }
            }
        }
        // align right
        if (matchHotKey("⇧⌘R", event)) {
            if (vditor.currentMode === "ir") {
                setTableAlign(tableElement, "right");
                execAfterRender(vditor);
                event.preventDefault();
                return true;
            } else {
                const itemElement: HTMLElement = vditor.wysiwyg.popover.querySelector('[data-type="right"]');
                if (itemElement) {
                    itemElement.click();
                    event.preventDefault();
                    return true;
                }
            }
        }
    }
    return false;
};

export const fixCodeBlock = (vditor: IVditor, event: KeyboardEvent, codeRenderElement: HTMLElement, range: Range) => {
    // command + a in a code block selects only that code block (CodeMirror blocks are handled by CM itself)
    if (codeRenderElement.tagName === "PRE" && matchHotKey("⌘A", event)) {
        if (codeRenderElement.closest(".vditor-code-block--cm") || isInsideCodeMirror(event.target)) {
            return false;
        }
        range.selectNodeContents(codeRenderElement.firstElementChild);
        event.preventDefault();
        return true;
    }

    // tab
    // TODO shift and selected text
    if (vditor.options.tab && event.key === "Tab" && range.toString() === "") {
        if (event.shiftKey) {
            removePreviousTab(range, vditor.options.tab);
        } else {
            range.insertNode(document.createTextNode(vditor.options.tab));
            range.collapse(false);
        }
        execAfterRender(vditor);
        event.preventDefault();
        return true;
    }

    // Backspace: caret at the zeroth character, only remove the code block markup
    if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey) {
        const codePosition = getSelectPosition(codeRenderElement, vditor[vditor.currentMode].element, range);
        if ((codePosition.start === 0 ||
            (codePosition.start === 1 && codeRenderElement.innerText === "\n")) // empty code block, caret after \n
            && range.toString() === "") {
            codeRenderElement.parentElement.outerHTML =
                `<p data-block="0"><wbr>${codeRenderElement.firstElementChild.innerHTML}</p>`;
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }
    }

    // line break
    if (!isCtrl(event) && !event.altKey && event.key === "Enter") {
        if (!codeRenderElement.firstElementChild.textContent.endsWith("\n")) {
            codeRenderElement.firstElementChild.insertAdjacentText("beforeend", "\n");
        }
        range.extractContents();
        range.insertNode(document.createTextNode("\n"));
        range.collapse(false);
        setSelectionFocus(range);
        if (!isFirefox()) {
            if (vditor.currentMode === "wysiwyg") {
                input(vditor, range);
            } else {
                IRInput(vditor, range);
            }
        }
        event.preventDefault();
        return true;
    }
    return false;
};

const getBlockquoteLineElements = (topBlockquote: HTMLElement): HTMLElement[] => {
    const lines: HTMLElement[] = [];
    for (const child of topBlockquote.children) {
        const element = child as HTMLElement;
        if (element.tagName === "P") {
            lines.push(element);
        } else if (element.tagName === "BLOCKQUOTE") {
            for (const nestedLine of getBlockquoteLineElements(element)) {
                lines.push(nestedLine);
            }
        }
    }
    return lines;
};

const getBlockquoteAdjacentSibling = (element: HTMLElement, direction: "next" | "prev"): HTMLElement | null => {
    let current: HTMLElement | null = element;
    while (current) {
        const sibling = (direction === "next"
            ? current.nextElementSibling
            : current.previousElementSibling) as HTMLElement | null;
        if (sibling) {
            return sibling;
        }
        const parentElement = current.parentElement;
        if (parentElement?.tagName === "BLOCKQUOTE") {
            current = parentElement;
            continue;
        }
        break;
    }
    return null;
};

const focusBlockquoteLine = (range: Range, lineElement: HTMLElement, column: number, toEnd = false) => {
    const offset = Math.min(Math.max(column, 0), lineElement.textContent.length);
    if (!toEnd && offset === 0) {
        range.selectNodeContents(lineElement);
        range.collapse(true);
        setSelectionFocus(range);
        return;
    }
    if (toEnd || offset >= lineElement.textContent.length) {
        const lastNode = getLastNode(lineElement);
        if (lastNode.nodeType === 3) {
            range.setStart(lastNode, lastNode.textContent.length);
            range.collapse(true);
        } else {
            range.selectNodeContents(lineElement);
            range.collapse(false);
        }
        setSelectionFocus(range);
        return;
    }
    setSelectionByPosition(offset, offset, lineElement);
};

const focusBlockquoteAdjacent = (range: Range, element: HTMLElement, toStart: boolean) => {
    if (element.tagName === "BLOCKQUOTE") {
        const lines = getBlockquoteLineElements(element);
        if (lines.length > 0) {
            if (toStart) {
                focusBlockquoteLine(range, lines[0], 0);
            } else {
                focusBlockquoteLine(range, lines[lines.length - 1], 0, true);
            }
            return;
        }
    }
    if (toStart) {
        range.selectNodeContents(element);
        range.collapse(true);
    } else {
        range.selectNodeContents(element);
        range.collapse(false);
    }
    setSelectionFocus(range);
};

const exitBlockquoteForward = (range: Range, topBlockquote: HTMLElement, blockquoteElement: HTMLElement) => {
    const blockElement = topBlockquote || blockquoteElement;
    const nextElement = blockElement.nextElementSibling as HTMLElement;
    if (nextElement && nextElement.tagName !== "TABLE" && !nextElement.getAttribute("data-type")) {
        focusBlockquoteAdjacent(range, nextElement, true);
        return;
    }
    range.setStartAfter(blockElement);
    range.collapse(true);
    setSelectionFocus(range);
};

const exitBlockquoteBackward = (range: Range, topBlockquote: HTMLElement, blockquoteElement: HTMLElement) => {
    const blockElement = topBlockquote || blockquoteElement;
    const previousElement = blockElement.previousElementSibling as HTMLElement;
    if (previousElement && previousElement.tagName !== "TABLE" && !previousElement.getAttribute("data-type")) {
        focusBlockquoteAdjacent(range, previousElement, false);
        return;
    }
    range.setStartBefore(blockElement);
    range.collapse(true);
    setSelectionFocus(range);
};

const insertAfterBlockquoteLine = (vditor: IVditor, event: KeyboardEvent, range: Range, lineElement: HTMLElement,
    blockquoteElement: HTMLElement) => {
    const position = getSelectPosition(lineElement, vditor[vditor.currentMode].element, range);
    if ((event.key === "ArrowDown" && lineElement.textContent.trimRight().substr(position.start).indexOf("\n") === -1) ||
        (event.key === "ArrowRight" && position.start >= lineElement.textContent.trimRight().length)) {
        const topBlockquote = hasTopClosestByTag(range.startContainer, "BLOCKQUOTE") as HTMLElement;
        const lines = getBlockquoteLineElements(topBlockquote || blockquoteElement);
        const lineIndex = lines.indexOf(lineElement);
        const nextLine = lineIndex > -1 ? lines[lineIndex + 1] : undefined;
        if (nextLine) {
            focusBlockquoteLine(range, nextLine, position.start);
        } else if (lineIndex === -1) {
            const nextElement = getBlockquoteAdjacentSibling(lineElement, "next");
            if (nextElement && nextElement.tagName !== "TABLE" && !nextElement.getAttribute("data-type")) {
                focusBlockquoteAdjacent(range, nextElement, true);
            } else {
                exitBlockquoteForward(range, topBlockquote, blockquoteElement);
            }
        } else {
            exitBlockquoteForward(range, topBlockquote, blockquoteElement);
        }
        event.preventDefault();
        return true;
    }
    return false;
};

const insertBeforeBlockquoteLine = (vditor: IVditor, event: KeyboardEvent, range: Range, lineElement: HTMLElement,
    blockquoteElement: HTMLElement) => {
    const position = getSelectPosition(lineElement, vditor[vditor.currentMode].element, range);
    if ((event.key === "ArrowUp" && lineElement.textContent.substr(0, position.start).indexOf("\n") === -1) ||
        ((event.key === "ArrowLeft" || (event.key === "Backspace" && range.toString() === "")) &&
            position.start === 0)) {
        const topBlockquote = hasTopClosestByTag(range.startContainer, "BLOCKQUOTE") as HTMLElement;
        const lines = getBlockquoteLineElements(topBlockquote || blockquoteElement);
        const lineIndex = lines.indexOf(lineElement);
        const previousLine = lineIndex > -1 ? lines[lineIndex - 1] : undefined;
        if (previousLine) {
            focusBlockquoteLine(range, previousLine, position.start, event.key !== "ArrowUp");
        } else if (lineIndex === -1) {
            const previousElement = getBlockquoteAdjacentSibling(lineElement, "prev");
            if (previousElement && previousElement.tagName !== "TABLE" && !previousElement.getAttribute("data-type")) {
                focusBlockquoteAdjacent(range, previousElement, false);
            } else {
                exitBlockquoteBackward(range, topBlockquote, blockquoteElement);
            }
        } else {
            exitBlockquoteBackward(range, topBlockquote, blockquoteElement);
        }
        event.preventDefault();
        return true;
    }
    return false;
};

export const fixBlockquote = (vditor: IVditor, range: Range, event: KeyboardEvent, pElement: HTMLElement | false) => {
    const startContainer = range.startContainer;
    const blockquoteElement = hasClosestByMatchTag(startContainer, "BLOCKQUOTE");
    if (blockquoteElement && range.toString() === "") {
        if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey &&
            getSelectPosition(blockquoteElement, vditor[vditor.currentMode].element, range).start === 0) {
            // Backspace: caret at the zeroth character of a blockquote, only remove the blockquote markup
            range.insertNode(document.createElement("wbr"));
            blockquoteElement.outerHTML = blockquoteElement.innerHTML;
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        if (pElement && event.key === "Enter" && !isCtrl(event) && !event.shiftKey && !event.altKey
            && pElement.parentElement.tagName === "BLOCKQUOTE") {
            // Enter: Enter on an empty line exits one level at a time
            let isEmpty = false;
            const pText = pElement.textContent.replace(Constants.ZWSP, "");
            if (pText === "" || pText === "\n") {
                // empty P (including one holding only a <wbr> placeholder)
                isEmpty = true;
                pElement.remove();
            } else if (pElement.innerHTML.endsWith("\n\n") &&
                getSelectPosition(pElement, vditor[vditor.currentMode].element, range).start ===
                pElement.textContent.length - 1) {
                // soft line break
                pElement.innerHTML = pElement.innerHTML.substr(0, pElement.innerHTML.length - 2);
                isEmpty = true;
            }
            if (isEmpty) {
                // a zero-width character is required, otherwise undo cannot be recorded
                blockquoteElement.insertAdjacentHTML("afterend", `<p data-block="0">${Constants.ZWSP}<wbr>\n</p>`);
                setRangeByWbr(vditor[vditor.currentMode].element, range);
                execAfterRender(vditor);
                event.preventDefault();
                return true;
            }
            // Enter: in a non-empty blockquote, break the line within the paragraph (caret between \n and the ZWSP, no visible space)
            const textNode = document.createTextNode("\n" + Constants.ZWSP);
            range.insertNode(textNode);
            range.setStart(textNode, 1);
            range.collapse(true);
            setSelectionFocus(range);
            event.preventDefault();
            return true;
        }
        const blockElement = hasClosestBlock(startContainer);
        if (vditor.currentMode === "wysiwyg" && blockElement && matchHotKey("⇧⌘;", event)) {
            // insert a blockquote
            range.insertNode(document.createElement("wbr"));
            blockElement.outerHTML = `<blockquote data-block="0">${blockElement.outerHTML}</blockquote>`;
            setRangeByWbr(vditor.wysiwyg.element, range);
            afterRenderEvent(vditor);
            event.preventDefault();
            return true;
        }

        if (pElement) {
            if (insertAfterBlockquoteLine(vditor, event, range, pElement, blockquoteElement)) {
                return true;
            }
            if (insertBeforeBlockquoteLine(vditor, event, range, pElement, blockquoteElement)) {
                return true;
            }
        } else {
            if (insertAfterBlock(vditor, event, range, blockquoteElement, blockquoteElement)) {
                return true;
            }
            if (insertBeforeBlock(vditor, event, range, blockquoteElement, blockquoteElement)) {
                return true;
            }
        }
    }
    return false;
};

export const fixTask = (vditor: IVditor, range: Range, event: KeyboardEvent) => {
    const startContainer = range.startContainer;
    const taskItemElement = hasClosestByClassName(startContainer, "vditor-task");
    if (taskItemElement) {
        if (matchHotKey("⇧⌘J", event)) {
            // ctrl + shift: toggle checked
            const inputElement = taskItemElement.firstElementChild as HTMLInputElement;
            if (inputElement.checked) {
                inputElement.removeAttribute("checked");
            } else {
                inputElement.setAttribute("checked", "checked");
            }
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        // Backspace: deleting before the checkbox
        if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey && range.toString() === ""
            && range.startOffset === 1
            && ((startContainer.nodeType === 3 && startContainer.previousSibling &&
                (startContainer.previousSibling as HTMLElement).tagName === "INPUT")
                || startContainer.nodeType !== 3)) {
            const previousElement = taskItemElement.previousElementSibling;
            taskItemElement.querySelector("input").remove();
            if (previousElement) {
                const lastNode = getLastNode(previousElement);
                lastNode.parentElement.insertAdjacentHTML("beforeend", "<wbr>" + taskItemElement.innerHTML.trim());
                taskItemElement.remove();
            } else {
                taskItemElement.parentElement.insertAdjacentHTML("beforebegin",
                    `<p data-block="0"><wbr>${taskItemElement.innerHTML.trim() || "\n"}</p>`);
                if (taskItemElement.nextElementSibling) {
                    taskItemElement.remove();
                } else {
                    taskItemElement.parentElement.remove();
                }
            }
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }

        if (event.key === "Enter" && !isCtrl(event) && !event.shiftKey && !event.altKey) {
            if (taskItemElement.textContent.trim() === "") {
                // the current task item has no text
                if (hasClosestByClassName(taskItemElement.parentElement, "vditor-task")) {
                    // when it is a nested item, outdent it
                    const topListElement = getTopList(startContainer);
                    if (topListElement) {
                        listOutdent(vditor, taskItemElement, range, topListElement);
                    }
                } else {
                    // single-level task list
                    if (taskItemElement.nextElementSibling) {
                        // more elements follow the task list, separate them with a paragraph
                        let afterHTML = "";
                        let beforeHTML = "";
                        let isAfter = false;
                        Array.from(taskItemElement.parentElement.children).forEach((taskItem) => {
                            if (taskItemElement.isSameNode(taskItem)) {
                                isAfter = true;
                            } else {
                                if (isAfter) {
                                    afterHTML += taskItem.outerHTML;
                                } else {
                                    beforeHTML += taskItem.outerHTML;
                                }
                            }
                        });
                        const parentTagName = taskItemElement.parentElement.tagName;
                        const dataMarker = taskItemElement.parentElement.tagName === "OL" ? "" : ` data-marker="${taskItemElement.parentElement.getAttribute("data-marker")}"`;
                        let startAttribute = "";
                        if (beforeHTML) {
                            startAttribute = taskItemElement.parentElement.tagName === "UL" ? "" : ` start="1"`;
                            beforeHTML = `<${parentTagName} data-tight="true"${dataMarker} data-block="0">${beforeHTML}</${parentTagName}>`;
                        }
                        // <p data-block="0">\n<wbr></p> => <p data-block="0"><wbr>\n</p>
                        // https://github.com/Vanessa219/vditor/issues/430
                        taskItemElement.parentElement.outerHTML = `${beforeHTML}<p data-block="0"><wbr>\n</p><${parentTagName}
 data-tight="true"${dataMarker} data-block="0"${startAttribute}>${afterHTML}</${parentTagName}>`;
                    } else {
                        // no task items follow
                        taskItemElement.parentElement.insertAdjacentHTML("afterend", `<p data-block="0"><wbr>\n</p>`);
                        if (taskItemElement.parentElement.querySelectorAll("li").length === 1) {
                            // if the task list has only one item, replace it with a p element
                            taskItemElement.parentElement.remove();
                        } else {
                            // if the task list has several items and this is the last one, remove it
                            taskItemElement.remove();
                        }
                    }
                }
            } else if (startContainer.nodeType !== 3 && range.startOffset === 0 &&
                (startContainer.firstChild as HTMLElement).tagName === "INPUT") {
                // caret before the input
                range.setStart(startContainer.childNodes[1], 1);
            } else {
                // the current task item has text: move the text after the caret into a new task item
                range.setEndAfter(taskItemElement.lastChild);
                taskItemElement.insertAdjacentHTML("afterend", `<li class="vditor-task" data-marker="${taskItemElement.getAttribute("data-marker")}"><input type="checkbox"> <wbr></li>`);
                document.querySelector("wbr").after(range.extractContents());
            }
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }
    }
    return false;
};

export const fixDelete = (vditor: IVditor, range: Range, event: KeyboardEvent, pElement: HTMLElement | false) => {
    if (range.startContainer.nodeType !== 3) {
        // caret before the hr, with content before the hr
        const rangeElement = (range.startContainer as HTMLElement).children[range.startOffset];
        if (rangeElement && rangeElement.tagName === "HR") {
            range.selectNodeContents(rangeElement.previousElementSibling);
            range.collapse(false);
            event.preventDefault();
            return true;
        }
    }

    if (pElement) {
        const previousElement = pElement.previousElementSibling;
        if (previousElement && getSelectPosition(pElement, vditor[vditor.currentMode].element, range).start === 0 &&
            ((isFirefox() && previousElement.tagName === "HR") || previousElement.tagName === "TABLE")) {
            if (previousElement.tagName === "TABLE") {
                // deleting after a table https://github.com/Vanessa219/vditor/issues/243
                const lastCellElement = previousElement.lastElementChild.lastElementChild.lastElementChild;
                lastCellElement.innerHTML =
                    lastCellElement.innerHTML.trimLeft() + "<wbr>" + pElement.textContent.trim();
                pElement.remove();
            } else {
                // deleting with the caret after the hr
                previousElement.remove();
            }
            setRangeByWbr(vditor[vditor.currentMode].element, range);
            execAfterRender(vditor);
            event.preventDefault();
            return true;
        }
    }
    return false;
};

export const fixHR = (range: Range) => {
    if (isFirefox() && range.startContainer.nodeType !== 3 &&
        (range.startContainer as HTMLElement).tagName === "HR") {
        range.setStartBefore(range.startContainer);
    }
};

// firefox https://github.com/Vanessa219/vditor/issues/407
export const fixFirefoxArrowUpTable = (event: KeyboardEvent, blockElement: false | HTMLElement, range: Range) => {
    if (!isFirefox()) {
        return false;
    }
    if (event.key === "ArrowUp" && blockElement && blockElement.previousElementSibling?.tagName === "TABLE") {
        const tableElement = blockElement.previousElementSibling as HTMLTableElement;
        range.selectNodeContents(tableElement.rows[tableElement.rows.length - 1].lastElementChild);
        range.collapse(false);
        event.preventDefault();
        return true;
    }
    if (event.key === "ArrowDown" && blockElement && blockElement.nextElementSibling?.tagName === "TABLE") {
        range.selectNodeContents((blockElement.nextElementSibling as HTMLTableElement).rows[0].cells[0]);
        range.collapse(true);
        event.preventDefault();
        return true;
    }
    return false;
};

const preparePastePlainText = (vditor: IVditor, text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) {
        return text;
    }
    const range = getEditorRange(vditor);
    const selectedText = range.toString();
    if (selectedText && isPasteableUrl(trimmed)) {
        if (!range.collapsed) {
            range.deleteContents();
        }
        return linkifyPastePlainText(text, selectedText);
    }
    return linkifyPastePlainText(text);
};

export const paste = async (vditor: IVditor, event: (ClipboardEvent | DragEvent) & { target: HTMLElement }, callback: {
    pasteCode(code: string): void,
}) => {
    if (vditor[vditor.currentMode].element.getAttribute("contenteditable") !== "true") {
        return;
    }
    if (isInsideCodeMirror(event.target)) {
        return;
    }
    event.stopPropagation();
    event.preventDefault();
    clearPendingHistoryTimeout(vditor);
    let textHTML;
    let textPlain;
    let files;
    let pastedFromMarkdown = false;

    if ("clipboardData" in event) {
        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");
        files = event.clipboardData.files;
    } else {
        textHTML = event.dataTransfer.getData("text/html");
        textPlain = event.dataTransfer.getData("text/plain");
        if (event.dataTransfer.types.includes("Files")) {
            files = event.dataTransfer.items;
        }
    }
    const renderers: {
        HTML2VditorDOM?: ILuteRender,
        HTML2VditorIRDOM?: ILuteRender,
        Md2VditorDOM?: ILuteRender,
        Md2VditorIRDOM?: ILuteRender,
    } = {};
    const renderLinkDest: ILuteRenderCallback = (node, entering) => {
        if (!entering) {
            return ["", Lute.WalkContinue];
        }

        const src = node.TokensStr();
        if (node.__internal_object__.Parent.Type === 34 && src && src.indexOf("file://") === -1 &&
            vditor.options.upload.linkToImgUrl) {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", vditor.options.upload.linkToImgUrl);
            if (vditor.options.upload.token) {
                xhr.setRequestHeader("X-Upload-Token", vditor.options.upload.token);
            }
            if (vditor.options.upload.withCredentials) {
                xhr.withCredentials = true;
            }
            setHeaders(vditor, xhr);
            xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
            xhr.onreadystatechange = () => {
                if (xhr.readyState === XMLHttpRequest.DONE) {
                    if (xhr.status === 200) {
                        let responseText = xhr.responseText;
                        if (vditor.options.upload.linkToImgFormat) {
                            responseText = vditor.options.upload.linkToImgFormat(xhr.responseText);
                        }
                        const responseJSON = JSON.parse(responseText);
                        if (responseJSON.code !== 0) {
                            vditor.tip.show(responseJSON.msg);
                            return;
                        }
                        const original = responseJSON.data.originalURL;
                        const imgElement: HTMLImageElement =
                            vditor[vditor.currentMode].element.querySelector(`img[src="${original}"]`);
                        imgElement.src = responseJSON.data.url;
                        if (vditor.currentMode === "ir") {
                            imgElement.previousElementSibling.previousElementSibling.innerHTML =
                                responseJSON.data.url;
                        }
                        execAfterRender(vditor);
                    } else {
                        vditor.tip.show(xhr.responseText);
                    }
                    if (vditor.options.upload.linkToImgCallback) {
                        vditor.options.upload.linkToImgCallback(xhr.responseText);
                    }
                }
            };
            xhr.send(JSON.stringify({ url: src }));
        }
        if (vditor.currentMode === "ir") {
            return [`<span class="vditor-ir__marker vditor-ir__marker--link">${Lute.EscapeHTMLStr(src)}</span>`, Lute.WalkContinue];
        }
        return ["", Lute.WalkContinue];
    };

    // handle text copied from the browser address bar
    if (textHTML.replace(/&amp;/g, "&").replace(/<(|\/)(html|body|meta)[^>]*?>/ig, "").trim() ===
        `<a href="${textPlain}">${textPlain}</a>` ||
        textHTML.replace(/&amp;/g, "&").replace(/<(|\/)(html|body|meta)[^>]*?>/ig, "").trim() ===
        `<!--StartFragment--><a href="${textPlain}">${textPlain}</a><!--EndFragment-->`) {
        textHTML = "";
    }

    // process word
    const doc = new DOMParser().parseFromString(textHTML, "text/html");
    if (doc.body) {
        textHTML = doc.body.innerHTML;
    }
    textHTML = Lute.Sanitize(textHTML);

    let vscodeEditorData = "";
    if ("clipboardData" in event && event.clipboardData.types.includes("vscode-editor-data")) {
        vscodeEditorData = event.clipboardData.getData("vscode-editor-data");
    } else if (event.dataTransfer?.types.includes("vscode-editor-data")) {
        vscodeEditorData = event.dataTransfer.getData("vscode-editor-data");
    }

    const routed = routePasteClipboard(textHTML, textPlain, vscodeEditorData);
    textHTML = routed.textHTML;
    textPlain = routed.textPlain;

    // process code
    const code = processPasteCode(textHTML, textPlain, vditor.currentMode, vscodeEditorData);
    const codeElement = hasClosestByMatchTag(event.target, "CODE");
    if (codeElement) {
        // pasting inside code
        const position = getSelectPosition(event.target, vditor[vditor.currentMode].element);
        if (codeElement.parentElement.tagName !== "PRE") {
            // https://github.com/Vanessa219/vditor/issues/463
            textPlain += Constants.ZWSP;
        }
        codeElement.textContent = codeElement.textContent.substring(0, position.start)
            + textPlain + codeElement.textContent.substring(position.end);
        setSelectionByPosition(position.start + textPlain.length, position.start + textPlain.length,
            codeElement.parentElement);
        if (codeElement.parentElement?.nextElementSibling.classList
            .contains(`vditor-${vditor.currentMode}__preview`)) {
            codeElement.parentElement.nextElementSibling.innerHTML = codeElement.outerHTML;
            processCodeRender(codeElement.parentElement.nextElementSibling as HTMLElement, vditor);
        }
    } else if (code) {
        pastedFromMarkdown = true;
        callback.pasteCode(code);
    } else {
        let preparedPlain = textPlain;
        if (textPlain.trim() !== "") {
            preparedPlain = preparePastePlainText(vditor, textPlain);
        }
        if (preparedPlain !== textPlain) {
            textPlain = preparedPlain;
            textHTML = "";
        }
        if (textHTML.trim() !== "") {
            const tempElement = document.createElement("div");
            tempElement.innerHTML = textHTML;
            tempElement.querySelectorAll("[style]").forEach((e) => {
                e.removeAttribute("style");
            });
            tempElement.querySelectorAll(".vditor-copy").forEach((e) => {
                e.remove();
            });
            if (vditor.currentMode === "ir") {
                renderers.HTML2VditorIRDOM = { renderLinkDest };
                vditor.lute.SetJSRenderers({ renderers });
                insertHTML(vditor.lute.HTML2VditorIRDOM(tempElement.innerHTML), vditor);
            } else if (vditor.currentMode === "wysiwyg") {
                renderers.HTML2VditorDOM = { renderLinkDest };
                vditor.lute.SetJSRenderers({ renderers });
                insertHTML(vditor.lute.HTML2VditorDOM(tempElement.innerHTML), vditor);
            }
            markOutlineEditing(vditor);
            vditor.outline.render(vditor);
        } else if (files.length > 0) {
            if (vditor.options.upload.url || vditor.options.upload.handler) {
                await uploadFiles(vditor, files);
            } else {
                const fileReader = new FileReader();
                let file: File;
                if ("clipboardData" in event) {
                    files = event.clipboardData.files;
                    file = files[0];
                } else if (event.dataTransfer.types.includes("Files")) {
                    files = event.dataTransfer.items;
                    file = files[0].getAsFile();
                }
                if (file && file.type.startsWith("image")) {
                    fileReader.readAsDataURL(file);
                    fileReader.onload = () => {
                        let imgHTML = ''
                        if (vditor.currentMode === "wysiwyg") {
                            imgHTML += `<img alt="${file.name}" src="${fileReader.result.toString()}">\n`;
                        } else {
                            imgHTML += `![${file.name}](${fileReader.result.toString()})\n`;
                        }
                        document.execCommand("insertHTML", false, imgHTML);
                    }
                }
            }
        } else if (textPlain.trim() !== "" && files.length === 0) {
            pastedFromMarkdown = true;
            if (vditor.currentMode === "ir") {
                renderers.Md2VditorIRDOM = { renderLinkDest };
                vditor.lute.SetJSRenderers({ renderers });
                insertHTML(vditor.lute.Md2VditorIRDOM(textPlain), vditor);
            } else if (vditor.currentMode === "wysiwyg") {
                renderers.Md2VditorDOM = { renderLinkDest };
                vditor.lute.SetJSRenderers({ renderers });
                insertHTML(vditor.lute.Md2VditorDOM(textPlain), vditor);
            }
            markOutlineEditing(vditor);
            vditor.outline.render(vditor);
        }
    }
    const blockElement = hasClosestBlock(getEditorRange(vditor).startContainer);
    if (blockElement && !pastedFromMarkdown) {
        // https://github.com/Vanessa219/vditor/issues/591
        const range = getEditorRange(vditor);
        vditor[vditor.currentMode].element.querySelectorAll("wbr").forEach((wbr) => {
            wbr.remove();
        });
        range.insertNode(document.createElement("wbr"));
        if (vditor.currentMode === "wysiwyg") {
            blockElement.outerHTML = vditor.lute.SpinVditorDOM(blockElement.outerHTML);
        } else {
            blockElement.outerHTML = vditor.lute.SpinVditorIRDOM(blockElement.outerHTML);
        }
        setRangeByWbr(vditor[vditor.currentMode].element, range);
    }
    vditor[vditor.currentMode].element.querySelectorAll(`.vditor-${vditor.currentMode}__preview[data-render='2']`)
        .forEach((item: HTMLElement) => {
            processCodeRender(item, vditor);
        });
    recordHistoryChange(vditor);
};
