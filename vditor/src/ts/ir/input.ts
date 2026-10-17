import {Constants} from "../constants";
import {isHeadingMD, isHrMD} from "../util/fixBrowserBehavior";
import {
    getTopList,
    hasClosestBlock, hasClosestByAttribute,
    hasClosestByClassName,
} from "../util/hasClosest";
import {hasClosestByTag} from "../util/hasClosestByHeadings";
import {log} from "../util/log";
import {processCodeRender} from "../util/processCode";
import {
    deactivateCodeMirrorsInScope,
    autoFocusCreatedBlockAfterSpin,
    focusCmBlockAtCursor,
    focusEmptyMathBlockAfterSpin,
    isCmCodeBlock,
    renderCodeBlocksInScope,
} from "../codeBlock/codeMirrorManager";
import {getEditorRange, getSelectPosition, preserveEditorScroll, setRangeByWbr} from "../util/selection";
import {expandMarker} from "./expandMarker";
import {scheduleRenderToc} from "../util/toc";
import {processAfterRender} from "./process";
import {getMarkdown} from "../markdown/getMarkdown";
import {fireContentInput} from "../util/saveToolbarState";

export const input = (vditor: IVditor, range: Range, ignoreSpace = false, event?: InputEvent) => {
    let blockElement = hasClosestBlock(range.startContainer);
    // Spaces can be typed before and after
    if (blockElement && !ignoreSpace && blockElement.getAttribute("data-type") !== "code-block") {
        if ((isHrMD(blockElement.innerHTML) && blockElement.previousElementSibling) ||
            isHeadingMD(blockElement.innerHTML)) {
            return;
        }

        // Handle leading and trailing spaces
        const startOffset = getSelectPosition(blockElement, vditor.ir.element, range).start;

        // Spaces can be typed at the start
        let startSpace = true;
        for (let i = startOffset - 1;
            // Space after a soft line break
             i > blockElement.textContent.substr(0, startOffset).lastIndexOf("\n");
             i--) {
            if (blockElement.textContent.charAt(i) !== " " &&
                // Deleting before multiple tabs must not create a code block https://github.com/Vanessa219/vditor/issues/162 1
                blockElement.textContent.charAt(i) !== "\t") {
                startSpace = false;
                break;
            }
        }
        if (startOffset === 0) {
            startSpace = false;
        }

        // Spaces can be typed at the end
        let endSpace = true;
        for (let i = startOffset - 1; i < blockElement.textContent.length; i++) {
            if (blockElement.textContent.charAt(i) !== " " && blockElement.textContent.charAt(i) !== "\n") {
                endSpace = false;
                break;
            }
        }

        if (startSpace) {
            fireContentInput(vditor, getMarkdown(vditor));
            return;
        }
        if (endSpace) {
            const markerElement = hasClosestByClassName(range.startContainer, "vditor-ir__marker");
            if (markerElement) {
                // inline marker space https://github.com/Vanessa219/vditor/issues/239
            } else {
                const previousNode = range.startContainer.previousSibling as HTMLElement;
                if (previousNode && previousNode.nodeType !== 3 && previousNode.classList.contains("vditor-ir__node--expand")) {
                    // FireFox https://github.com/Vanessa219/vditor/issues/239
                    previousNode.classList.remove("vditor-ir__node--expand");
                }
                fireContentInput(vditor, getMarkdown(vditor));
                return;
            }
        }
    }

    vditor.ir.element.querySelectorAll(".vditor-ir__node--expand").forEach((item) => {
        item.classList.remove("vditor-ir__node--expand");
    });

    if (!blockElement) {
        // Use the top-level block element; innerHTML should be used
        blockElement = vditor.ir.element;
    }

    // Save the caret: remove leftover wbr so that setRangeByWbr does not hit a stale marker at the start of the document
    vditor.ir.element.querySelectorAll("wbr").forEach((wbr) => {
        wbr.remove();
    });
    const previewRenderElement = hasClosestByClassName(range.startContainer, "vditor-ir__preview");
    if (previewRenderElement) {
        previewRenderElement.previousElementSibling.insertAdjacentHTML("beforeend", "<wbr>");
    } else {
        range.insertNode(document.createElement("wbr"));
    }

    // Remove styles added by the browser
    blockElement.querySelectorAll("[style]").forEach((item) => {
        item.removeAttribute("style");
    });

    if (blockElement.getAttribute("data-type") === "link-ref-defs-block") {
        // Update link references
        blockElement = vditor.ir.element;
    }

    const isIRElement = blockElement.isEqualNode(vditor.ir.element);
    const footnoteElement = hasClosestByAttribute(blockElement, "data-type", "footnotes-block");
    let html = "";
    if (!isIRElement) {
        const blockquoteElement = hasClosestByTag(range.startContainer, "BLOCKQUOTE");
        // Lists must go up to the top level
        const topListElement = getTopList(range.startContainer);
        if (topListElement) {
            blockElement = topListElement;
        }

        // Go up to the blockquote level, otherwise > --- is parsed as front-matter; a blockquote inside a list parses the blockquote; a list inside a blockquote parses the list
        if (blockquoteElement && (!topListElement || (topListElement && !blockquoteElement.contains(topListElement)))) {
            blockElement = blockquoteElement;
        }

        // Update footnotes
        if (footnoteElement) {
            blockElement = footnoteElement;
        }

        html = blockElement.outerHTML;

        if (blockElement.tagName === "UL" || blockElement.tagName === "OL") {
            // For a list, the lists above and below must be re-rendered as well
            const listPrevElement = blockElement.previousElementSibling;
            const listNextElement = blockElement.nextElementSibling;
            if (listPrevElement && (listPrevElement.tagName === "UL" || listPrevElement.tagName === "OL")) {
                html = listPrevElement.outerHTML + html;
                listPrevElement.remove();
            }
            if (listNextElement && (listNextElement.tagName === "UL" || listNextElement.tagName === "OL")) {
                html = html + listNextElement.outerHTML;
                listNextElement.remove();
            }
            // In Firefox, pressing enter in a list does not create a new list item https://github.com/Vanessa219/vditor/issues/194
            html = html.replace("<div><wbr><br></div>", "<li><p><wbr><br></p></li>");
        } else if (blockElement.previousElementSibling &&
            blockElement.previousElementSibling.textContent.replace(Constants.ZWSP, "") !== "" &&
            event && event.inputType === "insertParagraph") {
            // On a line break, the previous paragraph must be handled
            html = blockElement.previousElementSibling.outerHTML + html;
            blockElement.previousElementSibling.remove();
        }
        if (!blockElement.innerText.startsWith("```")) {
            // Add link references
            vditor.ir.element.querySelectorAll("[data-type='link-ref-defs-block']").forEach((item) => {
                if (item && !(blockElement as HTMLElement).isEqualNode(item)) {
                    html += item.outerHTML;
                    item.remove();
                }
            });

            // Add footnotes
            vditor.ir.element.querySelectorAll("[data-type='footnotes-block']").forEach((item) => {
                if (item && !(blockElement as HTMLElement).isEqualNode(item)) {
                    html += item.outerHTML;
                    item.remove();
                }
            });
        }
    } else {
        html = blockElement.innerHTML;
    }

    log("SpinVditorIRDOM", html, "argument", vditor.options.debugger);
    const spinBeforeHtml = html;
    const spinScope = isIRElement ? vditor.ir.element : blockElement;
    deactivateCodeMirrorsInScope(vditor, spinScope);
    html = vditor.lute.SpinVditorIRDOM(html);
    log("SpinVditorIRDOM", html, "result", vditor.options.debugger);

    preserveEditorScroll(vditor, () => {
        if (isIRElement) {
            blockElement.innerHTML = html;
        } else {
            blockElement.outerHTML = html;

            // Update the tip in the body
            if (footnoteElement) {
                const footnoteItemElement = hasClosestByAttribute(vditor.ir.element.querySelector("wbr"),
                    "data-type", "footnotes-def");
                if (footnoteItemElement) {
                    const footnoteItemText = footnoteItemElement.textContent;
                    const marker = footnoteItemText.substring(1, footnoteItemText.indexOf("]:"));
                    const footnoteRefElement = vditor.ir.element.querySelector(`sup[data-type="footnotes-ref"][data-footnotes-label="${marker}"]`);
                    if (footnoteRefElement) {
                        footnoteRefElement.setAttribute("aria-label",
                            footnoteItemText.substr(marker.length + 3).trim().substr(0, 24));
                    }
                }
            }
        }

        //  Merge and add linkrefs
        let firstLinkRefDefElement: HTMLElement;
        const allLinkRefDefsElement = vditor.ir.element.querySelectorAll("[data-type='link-ref-defs-block']");
        allLinkRefDefsElement.forEach((item: HTMLElement, index) => {
            if (index === 0) {
                firstLinkRefDefElement = item;
            } else {
                firstLinkRefDefElement.insertAdjacentHTML("beforeend", item.innerHTML);
                item.remove();
            }
        });
        if (allLinkRefDefsElement.length > 0) {
            vditor.ir.element.insertAdjacentElement("beforeend", allLinkRefDefsElement[0]);
        }

        // After merging, append footnotes at the end
        let firstFootnoteElement: HTMLElement;
        const allFootnoteElement = vditor.ir.element.querySelectorAll("[data-type='footnotes-block']");
        allFootnoteElement.forEach((item: HTMLElement, index) => {
            if (index === 0) {
                firstFootnoteElement = item;
            } else {
                firstFootnoteElement.insertAdjacentHTML("beforeend", item.innerHTML);
                item.remove();
            }
        });
        if (allFootnoteElement.length > 0) {
            vditor.ir.element.insertAdjacentElement("beforeend", allFootnoteElement[0]);
        }

        setRangeByWbr(vditor.ir.element, range);
        expandMarker(getEditorRange(vditor), vditor.ir.element);
    });

    let remountScope = spinScope;
    if (!isIRElement) {
        const wbrElement = vditor.ir.element.querySelector("wbr");
        if (wbrElement) {
            remountScope = hasClosestBlock(wbrElement) || vditor.ir.element;
        }
    }

    renderCodeBlocksInScope(vditor, remountScope);
    const activeRange = getEditorRange(vditor);
    if (!autoFocusCreatedBlockAfterSpin(vditor, vditor.ir.element, activeRange, spinBeforeHtml)) {
        focusCmBlockAtCursor(vditor, vditor.ir.element);
    }
    focusEmptyMathBlockAfterSpin(vditor, vditor.ir.element, activeRange, spinBeforeHtml);

    vditor.ir.element.querySelectorAll(".vditor-ir__preview[data-render='2']").forEach((item: HTMLElement) => {
        if (isCmCodeBlock(item.parentElement as HTMLElement)) {
            return;
        }
        if (!remountScope.contains(item)) {
            return;
        }
        processCodeRender(item, vditor);
    });

    scheduleRenderToc(vditor);

    processAfterRender(vditor, {
        enableAddUndoStack: true,
        enableHint: true,
        enableInput: true,
    });
};
