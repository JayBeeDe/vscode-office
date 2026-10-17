import { isIdeCodeHtml, isMarkdownLikePlain } from "./processCode";

const inlineHTMLTagInPlain = /<\/[a-zA-Z][\w:-]*>|<[a-zA-Z][\w:-]*(?:\s[^>]*)?\/?>/;

/**
 * Choose between HTML and plain text before pasting.
 *
 * 1. VS Code (vscode-editor-data): use plain text, the HTML is only a syntax-highlighting wrapper
 * 2. plain text already has Markdown structure or vditor inline HTML: drop the misleading HTML
 * 3. code HTML from other IDEs (IntelliJ etc.): keep the HTML so processPasteCode can detect the language
 * 4. anything else: keep the HTML and take the Word / web rich text path
 */
export const routePasteClipboard = (
    textHTML: string,
    textPlain: string,
    vscodeEditorData: string,
): { textHTML: string; textPlain: string } => {
    if (!textPlain.trim() || !textHTML.trim()) {
        return { textHTML, textPlain };
    }

    if (vscodeEditorData) {
        return { textHTML: "", textPlain };
    }

    if (inlineHTMLTagInPlain.test(textPlain) || isMarkdownLikePlain(textPlain)) {
        return { textHTML: "", textPlain };
    }

    if (isIdeCodeHtml(textHTML)) {
        return { textHTML, textPlain };
    }

    return { textHTML, textPlain };
};
