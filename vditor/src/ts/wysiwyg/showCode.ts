import {enterSpecialBlockEdit, focusCodeBlock, isSpecialPreviewBlock} from "../codeBlock/codeMirrorManager";
import { enterInlineMathEdit } from "../math/inlineMathCodeMirror";
import {setSelectionFocus} from "../util/selection";

const INLINE_PREVIEW_TYPES = new Set(["math-inline", "html-entity"]);

/** Inline math/html: clicking the preview expands the source code and focuses it */
const showInlineCode = (previewElement: HTMLElement, vditor: IVditor, first = true) => {
    const blockElement = previewElement.closest(".vditor-wysiwyg__block") as HTMLElement;
    if (!blockElement || !INLINE_PREVIEW_TYPES.has(blockElement.getAttribute("data-type") ?? "")) {
        return false;
    }
    if (blockElement.getAttribute("data-type") === "math-inline") {
        return enterInlineMathEdit(vditor, blockElement, first);
    }

    const previousElement = previewElement.previousElementSibling as HTMLElement;
    if (!previousElement) {
        return false;
    }

    const range = previousElement.ownerDocument.createRange();
    if (previousElement.tagName === "CODE") {
        previousElement.style.display = "inline-block";
        if (first) {
            range.setStart(previousElement.firstChild, 1);
        } else {
            range.selectNodeContents(previousElement);
        }
    } else {
        previousElement.style.display = "block";

        if (!previousElement.firstChild.firstChild) {
            previousElement.firstChild.appendChild(document.createTextNode(""));
        }
        range.selectNodeContents(previousElement.firstChild);
    }
    if (first) {
        range.collapse(true);
    } else {
        range.collapse(false);
    }
    setSelectionFocus(range);
    return true;
};

/** Clicking the preview: special blocks enter CodeMirror editing, regular blocks focus the existing CM; inline math/html expands the source code */
export const showCode = (previewElement: HTMLElement, vditor: IVditor, first = true) => {
    const blockElement = previewElement.closest(
        "[data-type='code-block'], [data-type='math-block']",
    ) as HTMLElement;
    if (blockElement) {
        if (isSpecialPreviewBlock(blockElement)) {
            enterSpecialBlockEdit(vditor, blockElement);
            return;
        }
        focusCodeBlock(blockElement, vditor, first);
        return;
    }
    showInlineCode(previewElement, vditor, first);
};

export const focusWysiwygCodeBlock = (blockElement: HTMLElement, vditor: IVditor, first = true) => {
    return focusCodeBlock(blockElement, vditor, first);
};
