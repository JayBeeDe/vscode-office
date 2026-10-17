import {Constants} from "../constants";
import {tryFocusAdjacentCodeMirror} from "../codeBlock/codeMirrorNavigation";
import {
    focusCodeMirror,
    getCodeMirrorView,
    isCmCodeBlock,
    isInsideCodeBlockChrome,
    isInsideCodeMirror,
} from "../codeBlock/codeMirrorManager";
import { focusCodeBlockChromeLanguage } from "../codeBlock/codeBlockChrome";
import {isCtrl} from "../util/compatibility";
import {
    fixBlockquote, fixCJKPosition,
    fixCodeBlock, fixCursorDownInlineMath,
    fixDelete, fixFirefoxArrowUpTable, fixGSKeyBackspace, fixHR,
    fixList,
    fixMarkdown,
    fixTab,
    fixTable,
    fixTask,
    insertAfterBlock, insertBeforeBlock, isFirstCell, isLastCell,
} from "../util/fixBrowserBehavior";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag,
} from "../util/hasClosest";
import {hasClosestByHeadings} from "../util/hasClosestByHeadings";
import {matchHotKey} from "../util/hotKey";
import {recordHistoryChange} from "../util/instantHistory";
import {getEditorRange, getSelectPosition, setSelectionFocus} from "../util/selection";
import {keydownToc} from "../util/toc";
import {expandMarkerWithMathSync} from "./expandMarkerSync";
import {handleHtmlEditorAltEnter} from "../htmlInline/htmlInlineEditor";
import {handleLinkPopoverAltEnter} from "../wysiwyg/highlightToolbarWYSIWYG";
import {processAfterRender, processHeading} from "./process";
import {skipZwspAfterInlineMath} from "../math/inlineMathCodeMirror";

export const processKeydown = (vditor: IVditor, event: KeyboardEvent) => {
    vditor.ir.composingLock = event.isComposing;
    if (event.isComposing) {
        return false;
    }

    if (isInsideCodeBlockChrome(event.target)) {
        event.stopPropagation();
        return true;
    }

    if (isInsideCodeMirror(event.target)) {
        const codeRenderElement = (event.target as HTMLElement).closest("[data-type='code-block']") as HTMLElement;
        if (event.key === "Escape" && codeRenderElement) {
            getCodeMirrorView(codeRenderElement)?.contentDOM.blur();
            event.preventDefault();
            return true;
        }
        if (!isCtrl(event) && !event.shiftKey && event.altKey && event.key === "Enter" && codeRenderElement) {
            if (focusCodeBlockChromeLanguage(vditor, codeRenderElement)) {
                event.preventDefault();
                return true;
            }
        }
        return false;
    }

    // ZWSP after a formula: skip it before input so that characters do not jump to the line start when the caret is at the start of the ZWSP
    if (event.key.length === 1 || event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
        skipZwspAfterInlineMath(getEditorRange(vditor), vditor);
    }

    // Record the caret for the first undo entry
    if (event.key.indexOf("Arrow") === -1 && event.key !== "Meta" && event.key !== "Control" && event.key !== "Alt" &&
        event.key !== "Shift" && event.key !== "CapsLock" && event.key !== "Escape" && !/^F\d{1,2}$/.test(event.key)) {
        vditor.undo.recordFirstPosition(vditor, event);
    }

    const range = getEditorRange(vditor);
    const startContainer = range.startContainer;

    if (!fixGSKeyBackspace(event, vditor, startContainer)) {
        return false;
    }

    fixCJKPosition(range, vditor, event);

    fixHR(range);

    // Only handle the following shortcuts
    if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key.indexOf("Arrow") === -1
        && !isCtrl(event) && event.key !== "Escape" && event.key !== "Delete") {
        return false;
    }
    // Line break inside italic, bold or inline code
    const newlineElement = hasClosestByAttribute(startContainer, "data-newline", "1");
    if (!isCtrl(event) && !event.altKey && !event.shiftKey && event.key === "Enter" && newlineElement
        && range.startOffset < newlineElement.textContent.length) {
        const beforeMarkerElement = newlineElement.previousElementSibling;
        if (beforeMarkerElement) {
            range.insertNode(document.createTextNode(beforeMarkerElement.textContent));
            range.collapse(false);
        }
        const afterMarkerElement = newlineElement.nextSibling;
        if (afterMarkerElement) {
            range.insertNode(document.createTextNode(afterMarkerElement.textContent));
            range.collapse(true);
        }
    }

    const pElement = hasClosestByMatchTag(startContainer, "P");

    if (tryFocusAdjacentCodeMirror(vditor, event, range)) {
        return true;
    }

    // Markdown handling
    if (fixMarkdown(event, vditor, pElement, range)) {
        return true;
    }
    // li
    if (fixList(range, vditor, pElement, event)) {
        return true;
    }
    // blockquote
    if (fixBlockquote(vditor, range, event, pElement)) {
        return true;
    }
    // Code block
    const preRenderElement = hasClosestByClassName(startContainer, "vditor-ir__marker--pre");
    if (preRenderElement && preRenderElement.tagName === "PRE") {
        const codeBlockElement = preRenderElement.parentElement;
        if (isCmCodeBlock(codeBlockElement)) {
            return false;
        }
        const codeRenderElement = preRenderElement.firstChild as HTMLElement;
        if (fixCodeBlock(vditor, event, preRenderElement, range)) {
            return true;
        }
        // No element above the math formula: pressing up or left adds a new block
        if ((codeRenderElement.getAttribute("data-type") === "math-block"
            || codeRenderElement.getAttribute("data-type") === "html-block") &&
            insertBeforeBlock(vditor, event, range, codeRenderElement, preRenderElement.parentElement)) {
            return true;
        }

        // No element below the code block, or it is a code block/table: add an empty block
        if (insertAfterBlock(vditor, event, range, codeRenderElement, preRenderElement.parentElement)) {
            return true;
        }
    }
    // table
    const cellElement = hasClosestByMatchTag(startContainer, "TD") ||
        hasClosestByMatchTag(startContainer, "TH");
    if (event.key.indexOf("Arrow") > -1 && cellElement) {
        const tableElement = isFirstCell(cellElement);
        if (tableElement && insertBeforeBlock(vditor, event, range, cellElement, tableElement)) {
            return true;
        }

        const table2Element = isLastCell(cellElement);
        if (table2Element && insertAfterBlock(vditor, event, range, cellElement, table2Element)) {
            return true;
        }
    }
    if (fixTable(vditor, event, range)) {
        return true;
    }

    // task list
    if (fixTask(vditor, range, event)) {
        return true;
    }

    // alt+enter: open the html / link / image edit popup
    if (event.altKey && event.key === "Enter" && !isCtrl(event) && !event.shiftKey) {
        if (handleHtmlEditorAltEnter(vditor, range)) {
            event.preventDefault();
            return true;
        }
        if (handleLinkPopoverAltEnter(vditor, range)) {
            event.preventDefault();
            return true;
        }
    }

    // tab
    if (fixTab(vditor, range, event)) {
        return true;
    }

    const headingElement = hasClosestByHeadings(startContainer);
    if (headingElement) {
        // enter++: increase heading size
        if (matchHotKey("⌘=", event)) {
            const headingMarkerElement = headingElement.querySelector(".vditor-ir__marker--heading");
            if (headingMarkerElement && headingMarkerElement.textContent.trim().length > 1) {
                processHeading(vditor, headingMarkerElement.textContent.substr(1));
            }
            event.preventDefault();
            return true;
        }

        // enter++: decrease heading size
        if (matchHotKey("⌘-", event)) {
            const headingMarkerElement = headingElement.querySelector(".vditor-ir__marker--heading");
            if (headingMarkerElement && headingMarkerElement.textContent.trim().length < 6) {
                processHeading(vditor, headingMarkerElement.textContent.trim() + "# ");
            }
            event.preventDefault();
            return true;
        }
    }

    // shift+enter: hard line break inside a paragraph (\n + ZWSP); table is handled by fixTable above
    // With pre-wrap, inserting only \n at the end of a paragraph does not move the caret to a new line, so a ZWSP placeholder is needed https://github.com/Vanessa219/vditor/issues/170
    if (!isCtrl(event) && event.shiftKey && !event.altKey && event.key === "Enter" && !headingElement) {
        const textNode = document.createTextNode("\n" + Constants.ZWSP);
        range.insertNode(textNode);
        range.setStart(textNode, 1);
        range.collapse(true);
        setSelectionFocus(range);
        processAfterRender(vditor);
        event.preventDefault();
        return true;
    }

    const blockElement = hasClosestBlock(startContainer);
    if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey && range.toString() === "") {
        if (fixDelete(vditor, range, event, pElement)) {
            return true;
        }

        if (blockElement && blockElement.previousElementSibling
            && blockElement.tagName !== "UL" && blockElement.tagName !== "OL"
            && (blockElement.previousElementSibling.getAttribute("data-type") === "code-block" ||
                blockElement.previousElementSibling.getAttribute("data-type") === "math-block")) {
            const rangeStart = getSelectPosition(blockElement, vditor.ir.element, range).start;
            if (rangeStart === 0 || (rangeStart === 1 && blockElement.innerText.startsWith(Constants.ZWSP))) {
                const prevBlock = blockElement.previousElementSibling as HTMLElement;
                if (isCmCodeBlock(prevBlock)) {
                    focusCodeMirror(prevBlock, false, vditor);
                } else {
                    range.selectNodeContents(prevBlock.querySelector(".vditor-ir__marker--pre code"));
                    range.collapse(false);
                    expandMarkerWithMathSync(range, vditor);
                }
                if (blockElement.textContent.trim().replace(Constants.ZWSP, "") === "") {
                    // Delete the current block when it is empty and not the last one
                    blockElement.remove();
                    recordHistoryChange(vditor);
                }
                event.preventDefault();
                return true;
            }
        }

        // Caret is before the heading text, after the marker
        if (headingElement) {
            const headingLength = headingElement.firstElementChild.textContent.length;
            if (getSelectPosition(headingElement, vditor.ir.element).start === headingLength) {
                range.setStart(headingElement.firstElementChild.firstChild, headingLength - 1);
                range.collapse(true);
                setSelectionFocus(range);
            }
        }
    }

    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && blockElement) {
        // https://github.com/Vanessa219/vditor/issues/358
        blockElement.querySelectorAll(".vditor-ir__node").forEach((item: HTMLElement) => {
            if (!item.contains(startContainer)) {
                item.classList.add("vditor-ir__node--hidden");
            }
        });

        if (fixFirefoxArrowUpTable(event, blockElement, range)) {
            return true;
        }
    }
    fixCursorDownInlineMath(range, event.key);

    if (blockElement && keydownToc(blockElement, vditor, event, range)) {
        event.preventDefault();
        return true;
    }
    return false;
};
