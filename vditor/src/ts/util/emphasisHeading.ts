import { processAfterRender } from "../ir/process";
import { afterRenderEvent } from "../wysiwyg/afterRenderEvent";
import { renderTocNow } from "./toc";

/**
 * markdownlint MD036 (emphasis used instead of a heading): a paragraph that is only bold or italic
 * text, without final punctuation, becomes a heading once the caret leaves it (another line, or
 * Enter), so a line being typed is left alone. Its level is one below the previous heading's, and
 * never 1 after a top-level heading (MD025).
 */

const PUNCTUATION_RE = /[.,;:!?。，；：！？]$/;

const topBlock = (editor: HTMLElement, node: Node | null): HTMLElement | null => {
    let current: Node | null = node;
    while (current && current.parentNode !== editor) {
        current = current.parentNode;
    }
    return current && current.nodeType === 1 ? current as HTMLElement : null;
};

const isBlankNode = (node: Node) => node.nodeType === 3 && !(node.textContent || "").replace(/[\s​]/g, "");

/** The emphasised text when the paragraph is only one bold or italic run of plain text. */
const emphasisOnlyText = (block: HTMLElement): string | null => {
    if (block.tagName !== "P") {
        return null;
    }
    const meaningful = Array.from(block.childNodes).filter((node) => !isBlankNode(node) && (node as Element).tagName !== "BR" && (node as Element).tagName !== "WBR");
    if (meaningful.length !== 1 || meaningful[0].nodeType !== 1) {
        return null;
    }
    const wrapper = meaningful[0] as HTMLElement;
    // WYSIWYG: <strong>/<em>; IR: <span data-type="strong|em"> with its markers around <strong>/<em>
    const emphasis = /^(STRONG|EM)$/.test(wrapper.tagName) ?
        wrapper :
        /^(strong|em)$/.test(wrapper.getAttribute("data-type") || "") ? wrapper.querySelector("strong, em") as HTMLElement : null;
    if (!emphasis || emphasis.children.length > 0) {
        return null;
    }
    const text = (emphasis.textContent || "").replace(/​/g, "").trim();
    return text && !PUNCTUATION_RE.test(text) ? text : null;
};

const headingLevelBefore = (block: HTMLElement) => {
    let hasTop = false;
    let level = 0;
    for (let previous = block.previousElementSibling; previous; previous = previous.previousElementSibling) {
        const match = /^H([1-6])$/.exec(previous.tagName);
        if (match) {
            if (!level) {
                level = Number(match[1]);
            }
            if (match[1] === "1") {
                hasTop = true;
                break;
            }
        }
    }
    const next = Math.min(6, (level || 1) + (level ? 1 : 0));
    return hasTop ? Math.max(2, next) : next;
};

const toHeading = (vditor: IVditor, block: HTMLElement) => {
    const text = emphasisOnlyText(block);
    if (!text || !block.isConnected) {
        return;
    }
    const markdown = `${"#".repeat(headingLevelBefore(block))} ${text.replace(/([\\`*_\[\]<>#])/g, "\\$1")}`;
    const html = vditor.currentMode === "ir" ? vditor.lute.Md2VditorIRDOM(markdown) : vditor.lute.Md2VditorDOM(markdown);
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    const heading = template.content.firstElementChild;
    if (!heading || !/^H[1-6]$/.test(heading.tagName)) {
        return;
    }
    block.replaceWith(heading);
    renderTocNow(vditor);
    if (vditor.currentMode === "ir") {
        processAfterRender(vditor);
    } else {
        afterRenderEvent(vditor);
    }
};

export const bindEmphasisHeading = (vditor: IVditor) => {
    let lastBlock: HTMLElement | null = null;
    document.addEventListener("selectionchange", () => {
        const editor = vditor[vditor.currentMode]?.element as HTMLElement | undefined;
        const selection = window.getSelection();
        if (!editor || !selection || selection.rangeCount === 0) {
            return;
        }
        const node = selection.getRangeAt(0).startContainer;
        if (!editor.contains(node)) {
            return;
        }
        const block = topBlock(editor, node);
        if (block === lastBlock) {
            return;
        }
        const left = lastBlock;
        lastBlock = block;
        if (left && left.isConnected && editor.contains(left) && !vditor.wysiwyg?.composingLock) {
            toHeading(vditor, left);
        }
    });
};
