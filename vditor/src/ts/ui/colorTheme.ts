/** The extension's `vscode-office.theme` setting: `auto` follows VS Code's kind. */
export type IColorTheme = "auto" | "light" | "dark";

export const normalizeColorTheme = (theme?: string): IColorTheme =>
    theme === "light" || theme === "dark" ? theme : "auto";

export const isVscodeDarkTheme = () => {
    const kind = document.body.getAttribute("data-vscode-theme-kind");
    if (kind === "vscode-dark" || kind === "vscode-high-contrast") {
        return true;
    }
    if (kind === "vscode-light" || kind === "vscode-high-contrast-light") {
        return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
};

/** Whether the editor is dark: the setting, or VS Code's kind for `auto`. */
export const isEditorDark = (vditor: IVditor) => {
    const theme = normalizeColorTheme(vditor.options.colorTheme);
    return theme === "auto" ? isVscodeDarkTheme() : theme === "dark";
};

/** Whether the page is dark: vscode-office.markdown.theme, `auto` following the editor. */
export const isPageDark = (vditor: IVditor) => {
    const theme = normalizeColorTheme(vditor.options.pageTheme);
    return theme === "auto" ? isEditorDark(vditor) : theme === "dark";
};

/** The page panes (WYSIWYG and instant rendering), which follow vscode-office.markdown.theme. */
export const getPageElements = (vditor: IVditor): HTMLElement[] =>
    [vditor.wysiwyg?.element?.parentElement, vditor.ir?.element?.parentElement].filter(Boolean) as HTMLElement[];

/** The menus inside the page panes, which follow vscode-office.theme like the toolbar. */
export const getPaneMenuElements = (vditor: IVditor): HTMLElement[] =>
    [
        vditor.wysiwyg?.popover,
        vditor.ir?.popover,
        ...getPageElements(vditor).flatMap((page) => Array.from(page.querySelectorAll<HTMLElement>(":scope > .vditor-table-handle"))),
    ].filter(Boolean) as HTMLElement[];
