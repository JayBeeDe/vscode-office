/**
 * markdownlint MD025 (one top-level heading per file): a `#` heading can't be added after an
 * existing one. The heading menu greys out "Heading 1", and its shortcuts do nothing.
 */

const blockOf = (vditor: IVditor, node: Node | null): Element | null => {
    const editor = vditor[vditor.currentMode]?.element;
    let current: Node | null = node;
    while (current && current.parentNode !== editor) {
        current = current.parentNode;
    }
    return current && current.nodeType === 1 ? current as Element : null;
};

const isTopHeading = (element: Element) => (
    element.tagName === "H1" ||
    // the IR mode's heading being typed: "# " in a paragraph is rendered as h1 too
    (element.getAttribute("data-type") === "heading" && element.getAttribute("data-marker") === "#")
);

/** Whether a top-level heading comes before the block of the caret (other than that block). */
export const hasTopHeadingBeforeCaret = (vditor: IVditor) => {
    const editor = vditor[vditor.currentMode]?.element;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
        return false;
    }
    const block = blockOf(vditor, selection.getRangeAt(0).startContainer);
    if (!block) {
        return false;
    }
    for (let previous = block.previousElementSibling; previous; previous = previous.previousElementSibling) {
        if (isTopHeading(previous)) {
            return true;
        }
    }
    return false;
};
