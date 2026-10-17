import { Constants } from "../constants";
import { focusCodeBlockChromeLanguage } from "../codeBlock/codeBlockChrome";
import { tryFocusAdjacentCodeMirror } from "../codeBlock/codeMirrorNavigation";
import {
    focusCodeMirror,
    getCodeMirrorView,
    hasCodeMirror,
    isCmCodeBlock,
    isInsideCodeBlockChrome,
    isInsideCodeMirror,
} from "../codeBlock/codeMirrorManager";
import { isCtrl, isFirefox } from "../util/compatibility";
import {
    fixBlockquote, fixCJKPosition,
    fixCodeBlock, fixCursorDownInlineMath, fixDelete, fixFirefoxArrowUpTable, fixGSKeyBackspace, fixHR,
    fixHeadingEnter,
    fixList,
    fixMarkdown,
    fixTab,
    fixTable,
    fixTask, insertAfterBlock, insertBeforeBlock,
} from "../util/fixBrowserBehavior";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByMatchTag,
    hasTopClosestByTag,
} from "../util/hasClosest";
import { hasClosestByHeadings } from "../util/hasClosestByHeadings";
import { matchHotKey } from "../util/hotKey";
import { recordHistoryChange } from "../util/instantHistory";
import { getEditorRange, getSelectPosition, setSelectionFocus } from "../util/selection";
import { keydownToc, renderTocNow } from "../util/toc";
import { afterRenderEvent } from "./afterRenderEvent";
import { moveDown, moveUp, handleLinkPopoverAltEnter } from "./highlightToolbarWYSIWYG";
import { nextIsCode } from "./inlineTag";
import { removeHeading, setHeading } from "./setHeading";
import { focusWysiwygCodeBlock, showCode } from "./showCode";
import { enterInlineMathEdit, skipZwspAfterInlineMath } from "../math/inlineMathCodeMirror";
import { handleHtmlEditorAltEnter } from "../htmlInline/htmlInlineEditor";

export const processKeydown = (vditor: IVditor, event: KeyboardEvent) => {
    // Chrome and Firefox fire compositionend inconsistently https://github.com/Vanessa219/vditor/issues/188
    vditor.wysiwyg.composingLock = event.isComposing;
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
            vditor.wysiwyg.popover.style.display = "none";
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
        const pendingRange = getEditorRange(vditor);
        skipZwspAfterInlineMath(pendingRange, vditor);
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

    // Move up blocks that have a sub-toolbar
    if (matchHotKey("^⌘i", event) || matchHotKey("^!i", event)) {
        moveUp(range, vditor);
        event.stopPropagation();
    }

    // Move down blocks that have a sub-toolbar
    if (matchHotKey("^⌘j", event) || matchHotKey("^!j", event)) {
        moveDown(range, vditor);
        event.stopPropagation();
    }

    // Only handle the following shortcuts
    if (event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key.indexOf("Arrow") === -1
        && !isCtrl(event) && event.key !== "Escape" && event.key !== "Delete") {
        return false;
    }
    const blockElement = hasClosestBlock(startContainer);
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

    // table
    if (fixTable(vditor, event, range)) {
        return true;
    }

    // code render
    const codeRenderElement = hasClosestByClassName(startContainer, "vditor-wysiwyg__block");
    if (codeRenderElement) {
        // esc: exit editing
        if (event.key === "Escape" && codeRenderElement.getAttribute("data-type") === "code-block") {
            vditor.wysiwyg.popover.style.display = "none";
            if (hasCodeMirror(codeRenderElement) || isCmCodeBlock(codeRenderElement)) {
                getCodeMirrorView(codeRenderElement)?.contentDOM.blur();
                event.preventDefault();
                return true;
            }
            if (codeRenderElement.children.length === 2) {
                (codeRenderElement.firstElementChild as HTMLElement).style.display = "none";
                vditor.wysiwyg.element.blur();
                event.preventDefault();
                return true;
            }
        }

        // alt+enter: open the CodeMirror chrome language picker
        if (!isCtrl(event) && !event.shiftKey && event.altKey && event.key === "Enter" &&
            codeRenderElement.getAttribute("data-type") === "code-block") {
            if (focusCodeBlockChromeLanguage(vditor, codeRenderElement)) {
                event.preventDefault();
                return true;
            }
        }

        if (codeRenderElement.getAttribute("data-block") === "0") {
            if (hasCodeMirror(codeRenderElement) || isCmCodeBlock(codeRenderElement)) {
                return false;
            }
            if (fixCodeBlock(vditor, event, codeRenderElement.firstElementChild as HTMLElement, range)) {
                return true;
            }
            if (insertAfterBlock(vditor, event, range, codeRenderElement.firstElementChild as HTMLElement,
                codeRenderElement)) {
                return true;
            }

            if (codeRenderElement.getAttribute("data-type") !== "yaml-front-matter" &&
                insertBeforeBlock(vditor, event, range, codeRenderElement.firstElementChild as HTMLElement,
                    codeRenderElement)) {
                return true;
            }
        }
    }

    // blockquote
    if (fixBlockquote(vditor, range, event, pElement)) {
        return true;
    }

    // Top-level blockquote
    const topBQElement = hasTopClosestByTag(startContainer, "BLOCKQUOTE");
    if (topBQElement) {
        if (!event.shiftKey && event.altKey && event.key === "Enter") {
            if (!isCtrl(event)) {
                // alt+enter: exit nested blockquotes, inserting after them https://github.com/Vanessa219/vditor/issues/51
                range.setStartAfter(topBQElement);
            } else {
                // ctrl+alt+enter: exit nested blockquotes, inserting before them
                range.setStartBefore(topBQElement);
            }
            setSelectionFocus(range);
            const node = document.createElement("p");
            node.setAttribute("data-block", "0");
            node.innerHTML = "\n";
            range.insertNode(node);
            range.collapse(true);
            setSelectionFocus(range);
            afterRenderEvent(vditor);
            event.preventDefault();
            return true;
        }
    }

    // h1-h6
    const headingElement = hasClosestByHeadings(startContainer);
    if (headingElement) {
        if (!isCtrl(event) && !event.altKey && event.key === "Enter") {
            // enter/shift+enter: a line break in a heading should create a paragraph https://github.com/Vanessa219/vditor/issues/48
            fixHeadingEnter(vditor, range, headingElement);
            renderTocNow(vditor);
            afterRenderEvent(vditor);
            event.preventDefault();
            return true;
        }

        // enter++: increase heading size
        if (matchHotKey("⌘=", event)) {
            const index = parseInt((headingElement as HTMLElement).tagName.substr(1), 10) - 1;
            if (index > 0) {
                setHeading(vditor, `h${index}`);
                afterRenderEvent(vditor);
            }
            event.preventDefault();
            return true;
        }

        // enter++: decrease heading size
        if (matchHotKey("⌘-", event)) {
            const index = parseInt((headingElement as HTMLElement).tagName.substr(1), 10) + 1;
            if (index < 7) {
                setHeading(vditor, `h${index}`);
                afterRenderEvent(vditor);
            }
            event.preventDefault();
            return true;
        }

        if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey
            && headingElement.textContent.length === 1) {
            // Becomes empty after deletion
            removeHeading(vditor);
        }
    }

    // task list
    if (fixTask(vditor, range, event)) {
        return true;
    }

    // alt+enter
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

    // Delete blocks that have a sub-toolbar
    if (removeBlockElement(vditor, event)) {
        return true;
    }

    if (fixTab(vditor, range, event)) {
        return true;
    }

    // shift+enter: hard line break inside a paragraph (\n + ZWSP); table/heading etc. are handled by fixTable / fixHeadingEnter above
    // With pre-wrap, inserting only \n at the end of a paragraph does not move the caret to a new line, so a ZWSP placeholder is needed; same inside a line https://github.com/Vanessa219/vditor/issues/170
    if (!isCtrl(event) && event.shiftKey && !event.altKey && event.key === "Enter" && !headingElement) {
        const textNode = document.createTextNode("\n" + Constants.ZWSP);
        range.insertNode(textNode);
        range.setStart(textNode, 1);
        range.collapse(true);
        setSelectionFocus(range);
        afterRenderEvent(vditor);
        event.preventDefault();
        return true;
    }

    // Delete
    if (event.key === "Backspace" && !isCtrl(event) && !event.shiftKey && !event.altKey && range.toString() === "") {
        if (fixDelete(vditor, range, event, pElement)) {
            return true;
        }
        if (blockElement) {
            if (blockElement.previousElementSibling
                && blockElement.previousElementSibling.classList.contains("vditor-wysiwyg__block")
                && blockElement.previousElementSibling.getAttribute("data-block") === "0"
                // https://github.com/Vanessa219/vditor/issues/946
                && blockElement.tagName !== "UL" && blockElement.tagName !== "OL"
            ) {
                const rangeStart = getSelectPosition(blockElement, vditor.wysiwyg.element, range).start;
                if ((rangeStart === 0 && range.startOffset === 0) || // https://github.com/Vanessa219/vditor/issues/894
                    (rangeStart === 1 && blockElement.innerText.startsWith(Constants.ZWSP))) {
                    // After deleting, the caret lands on a rendered code block and the current block gets removed, so the event must be prevented; this cannot be merged with the code block handling in keyup
                    const prevBlock = blockElement.previousElementSibling as HTMLElement;
                    const prevPreview = prevBlock?.lastElementChild as HTMLElement;
                    if (!focusWysiwygCodeBlock(prevBlock, vditor, false) && prevPreview) {
                        showCode(prevPreview, vditor, false);
                    }
                    if (blockElement.innerHTML.trim().replace(Constants.ZWSP, "") === "") {
                        // Delete the current block when it is empty and not the last one
                        blockElement.remove();
                        recordHistoryChange(vditor);
                    }
                    event.preventDefault();
                    return true;
                }
            }

            const rangeStartOffset = range.startOffset;
            if (range.toString() === "" && startContainer.nodeType === 3 &&
                startContainer.textContent.charAt(rangeStartOffset - 2) === "\n" &&
                startContainer.textContent.charAt(rangeStartOffset - 1) !== Constants.ZWSP
                && ["STRONG", "STRIKE", "S", "I", "EM", "B"].includes(startContainer.parentElement.tagName)) {
                // Keep soft line breaks inside inline elements consistent
                startContainer.textContent = startContainer.textContent.substring(0, rangeStartOffset - 1) +
                    Constants.ZWSP;
                range.setStart(startContainer, rangeStartOffset);
                range.collapse(true);
                recordHistoryChange(vditor);
                event.preventDefault();
                return true;
            }

            // Deleting after the zero-width character before inline code, math or html
            if (startContainer.textContent === Constants.ZWSP && range.startOffset === 1
                && !startContainer.previousSibling && nextIsCode(range)) {
                startContainer.textContent = "";
                // Do not return: when preceded by a rendered code block, the following is needed. Fix: with the caret before inline math/html, pressing delete would remove the code content
            }

            // Fix: with the caret before inline math/html or html-entity, pressing delete would remove the code content
            // inline-math may now contain a CodeMirror host node, so do not rely on the first/lastElementChild order.
            blockElement.querySelectorAll("span.vditor-wysiwyg__block[data-type='math-inline']").forEach((item) => {
                const codeEl = item.querySelector("code[data-type='math-inline']") as HTMLElement | null;
                const previewEl = item.querySelector(".vditor-wysiwyg__preview") as HTMLElement | null;
                if (codeEl) codeEl.style.display = "inline";
                if (previewEl) previewEl.style.display = "none";
            });
            blockElement.querySelectorAll("span.vditor-wysiwyg__block[data-type='html-entity']").forEach((item) => {
                (item.firstElementChild as HTMLElement).style.display = "inline";
                (item.lastElementChild as HTMLElement).style.display = "none";
            });
        }
    }

    if (isFirefox() && range.startOffset === 1 && startContainer.textContent.indexOf(Constants.ZWSP) > -1 &&
        startContainer.previousSibling && startContainer.previousSibling.nodeType !== 3 &&
        (startContainer.previousSibling as HTMLElement).tagName === "CODE" &&
        (event.key === "Backspace" || event.key === "ArrowLeft")) {
        // https://github.com/Vanessa219/vditor/issues/410
        range.selectNodeContents(startContainer.previousSibling);
        range.collapse(false);
        event.preventDefault();
        return true;
    }

    if (fixFirefoxArrowUpTable(event, blockElement, range)) {
        event.preventDefault();
        return true;
    }

    fixCursorDownInlineMath(range, event.key);

    // Arrow navigation into inline math should enter CodeMirror editing.
    // When Ctrl/Meta is held, do NOT auto-enter (users may be word-jumping / selecting).
    if (range.toString() === "" && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !isCtrl(event)) {
        const currentInlineMath = hasClosestByAttribute(range.startContainer, "data-type", "math-inline") as HTMLElement | null;
        if (currentInlineMath) {
            // When moving left into an inline-math, caret should land at END; moving right should land at START.
            enterInlineMathEdit(vditor, currentInlineMath, event.key === "ArrowRight");
            event.preventDefault();
            return true;
        }

        const tryEnter = (el: Node | null, focusAtStart: boolean) => {
            const node = el instanceof HTMLElement ? el : (el as Node | null)?.parentElement;
            const inlineMath = node?.nodeType === 1 && (node as HTMLElement).getAttribute?.("data-type") === "math-inline"
                ? node as HTMLElement
                : (node as HTMLElement | null)?.closest?.("[data-type='math-inline']") as HTMLElement | null;
            if (inlineMath) {
                enterInlineMathEdit(vditor, inlineMath, focusAtStart);
                event.preventDefault();
                return true;
            }
            return false;
        };

        // caret between child nodes: startContainer can be an element
        if (startContainer.nodeType === 1) {
            const el = startContainer as Element;
            const next = el.childNodes[range.startOffset] ?? null;
            const prev = range.startOffset > 0 ? el.childNodes[range.startOffset - 1] : null;
            if (event.key === "ArrowRight" && tryEnter(next, true)) return true;
            if (event.key === "ArrowLeft" && tryEnter(prev, false)) return true;
        } else if (startContainer.nodeType === 3) {
            // Only enter inline-math when caret is at the boundary of the text node.
            const text = startContainer.textContent ?? "";
            const atStart = range.startOffset === 0;
            const atEnd = range.startOffset === text.length;
            const next = startContainer.nextSibling;
            const prev = startContainer.previousSibling;
            if (event.key === "ArrowRight" && atEnd && tryEnter(next, true)) return true;
            if (event.key === "ArrowLeft" && atStart && tryEnter(prev, false)) return true;
        }
    }

    if (event.key === "ArrowDown") {
        // With the caret before an inline math formula, the key press has no effect
        const nextElement = startContainer.nextSibling as HTMLElement;
        if (nextElement && nextElement.nodeType !== 3 && nextElement.getAttribute("data-type") === "math-inline") {
            range.setStartAfter(nextElement);
        }
    }

    if (blockElement && keydownToc(blockElement, vditor, event, range)) {
        event.preventDefault();
        return true;
    }

    return false;
};

export const removeBlockElement = (vditor: IVditor, event: KeyboardEvent) => {
    // Delete blocks that have a sub-toolbar
    if (matchHotKey("⇧⌘X", event)) {
        const itemElement: HTMLElement = vditor.wysiwyg.popover.querySelector('[data-type="remove"]');
        if (itemElement) {
            itemElement.click();
            event.preventDefault();
            return true;
        }
    }
};
