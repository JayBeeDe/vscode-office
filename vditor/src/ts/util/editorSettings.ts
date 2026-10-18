/**
 * The editor's display settings: the vscode-office.markdown.* settings of the extension, as ids
 * (`serif`, `a4`...). This turns them into the CSS variables the editor's styles read.
 */

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_DEFAULT = 13;
const LINE_HEIGHT_MIN = 1;
const LINE_HEIGHT_MAX = 3;
const LINE_HEIGHT_DEFAULT = 1.7;
const IMAGE_SIZE_MIN = 10;
const IMAGE_SIZE_MAX = 100;
const IMAGE_MAX_WIDTH_DEFAULT = 100;
const IMAGE_MAX_HEIGHT_DEFAULT = 70;

const FONT_FAMILIES: Record<string, string> = {
    "humanist": "Optima, Candara, 'Gill Sans', sans-serif",
    "serif": "Georgia, 'Times New Roman', serif",
    "old-style": "Palatino, 'Palatino Linotype', 'Book Antiqua', serif",
    "garamond": "Garamond, 'EB Garamond', 'Cormorant Garamond', serif",
    "charter": "Charter, 'Bitstream Charter', 'Sitka Text', serif",
    "slab-serif": "Rockwell, Georgia, serif",
    "narrow": "'Arial Narrow', 'Liberation Sans Narrow', sans-serif",
    "mono": "Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    "jetbrains-mono": "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    "courier": "'Courier New', Courier, monospace",
};

const CODE_FONT_FAMILIES: Record<string, string> = {
    "cascadia-code": "'Cascadia Code', 'Cascadia Mono', Consolas, monospace",
    "consolas": "Consolas, 'Courier New', monospace",
    "monaco": "Monaco, Menlo, monospace",
    "andale-mono": "'Andale Mono', Monaco, monospace",
    "courier-new": "'Courier New', Courier, monospace",
    "jetbrains-mono": "'JetBrains Mono', monospace",
    "fira-code": "'Fira Code', monospace",
};

const BOLD_COLORS: Record<string, string> = {
    plain: "var(--textarea-text-color, inherit)",
    accent: "var(--link-color, #0550ae)",
    red: "var(--error-color, #cf222e)",
    orange: "#bc4c00",
    purple: "#8250df",
    teal: "#1a7f64",
};

const PAGE_WIDTHS: Record<string, string> = {
    "a4": "210mm",
    "a5": "148mm",
    "b5": "176mm",
    "letter": "8.5in",
    "768px": "768px",
    "960px": "960px",
};

const CODE_BLOCK_MAX_HEIGHTS = ["300px", "400px", "600px", "800px"];

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, number));
};

const setOrRemove = (element: HTMLElement, name: string, value: string | undefined) => {
    if (value === undefined) {
        element.style.removeProperty(name);
    } else {
        element.style.setProperty(name, value);
    }
};

/** The document font size, in pixels. */
export const getEditorFontSize = (vditor: IVditor) =>
    clamp(vditor.options.editorSettings?.editorFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT);

/** The document font size one step bigger (1) or smaller (-1), within the setting's range. */
export const stepEditorFontSize = (vditor: IVditor, direction: 1 | -1) =>
    clamp(getEditorFontSize(vditor) + direction, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT);

export const applyEditorSettings = (vditor: IVditor) => {
    const settings = vditor.options.editorSettings ?? {};
    const element = vditor.element;
    element.style.setProperty("--ui-font-size",
        `${clamp(settings.uiFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT)}px`);
    element.style.setProperty("--editor-font-size", `${getEditorFontSize(vditor)}px`);
    element.style.setProperty("--editor-line-height",
        String(clamp(settings.editorLineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX, LINE_HEIGHT_DEFAULT)));
    setOrRemove(element, "--editor-font-family", FONT_FAMILIES[settings.editorFontFamily]);
    setOrRemove(element, "--code-font-family", CODE_FONT_FAMILIES[settings.codeFontFamily]);
    setOrRemove(element, "--bold-color", BOLD_COLORS[settings.boldColor]);

    const pageWidth = PAGE_WIDTHS[settings.pageWidth];
    setOrRemove(element, "--vditor-page-width", pageWidth);
    element.setAttribute("data-page-width-mode", pageWidth ? "fixed" : "fluid");

    element.style.setProperty("--vditor-image-max-width",
        `${clamp(settings.imageMaxWidth, IMAGE_SIZE_MIN, IMAGE_SIZE_MAX, IMAGE_MAX_WIDTH_DEFAULT)}%`);
    element.style.setProperty("--vditor-image-max-height",
        `${clamp(settings.imageMaxHeight, IMAGE_SIZE_MIN, IMAGE_SIZE_MAX, IMAGE_MAX_HEIGHT_DEFAULT)}vh`);
    setOrRemove(element, "--cm-block-max-height",
        CODE_BLOCK_MAX_HEIGHTS.includes(settings.codeBlockMaxHeight) ? settings.codeBlockMaxHeight : undefined);
};
