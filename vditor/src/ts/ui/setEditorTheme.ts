import {refreshMermaidTheme} from "../markdown/mermaidRender";
import {getPageElements, getPaneMenuElements, isEditorDark, isPageDark, normalizeColorTheme} from "./colorTheme";
import {initMobileOutlineMenu, prepareEditorThemeMobileOutline} from "./mobileOutlineMenu";
import {setCodeTheme} from "./setCodeTheme";
import {resolveMermaidTheme, syncMermaidTheme} from "./setMermaidTheme";
import {MERMAID_THEME_AUTO} from "./mermaidThemeCatalog";

/** The editor's two looks, bundled in index.css (css/editor-theme). */
export const LIGHT_EDITOR_THEME = "Light";
export const DARK_EDITOR_THEME = "One Dark";

let vscodeThemeObserverStarted = false;

const editorThemeOf = (dark: boolean) => dark ? DARK_EDITOR_THEME : LIGHT_EDITOR_THEME;

/**
 * Applies the light or dark looks: the toolbar, the outline and the menus follow
 * vscode-office.theme; the page panes follow vscode-office.markdown.theme, and code blocks and
 * Mermaid diagrams on `auto` follow the page.
 */
const applyColorTheme = (vditor: IVditor) => {
    const dark = isEditorDark(vditor);
    const theme = editorThemeOf(dark);
    document.documentElement.setAttribute("data-editor-theme", theme);
    vditor.element.setAttribute("data-editor-theme", theme);
    vditor.element.classList.toggle("vditor--dark", dark);
    for (const menu of getPaneMenuElements(vditor)) {
        menu.classList.add("vditor-ui");
        menu.setAttribute("data-editor-theme", theme);
    }

    const pageDark = isPageDark(vditor);
    const pageTheme = editorThemeOf(pageDark);
    const pages = getPageElements(vditor);
    const changed = pages.some((page) => page.getAttribute("data-editor-theme") !== pageTheme);
    for (const page of pages) {
        page.classList.add("vditor-page");
        page.classList.toggle("vditor-page--dark", pageDark);
        page.setAttribute("data-editor-theme", pageTheme);
    }
    prepareEditorThemeMobileOutline(vditor);
    setCodeTheme(vditor);
    syncMermaidTheme(vditor);
    if (changed && resolveMermaidTheme(vditor.options) === MERMAID_THEME_AUTO) {
        refreshMermaidTheme(vditor.element, vditor.options.cdn, vditor);
    }
};

const observeVscodeTheme = (vditor: IVditor) => {
    if (vscodeThemeObserverStarted || typeof MutationObserver === "undefined") {
        return;
    }
    vscodeThemeObserverStarted = true;
    const observer = new MutationObserver(() => {
        if (normalizeColorTheme(vditor.options.colorTheme) === "auto") {
            // the page on auto follows too
            applyColorTheme(vditor);
        }
    });
    observer.observe(document.body, {attributes: true, attributeFilter: ["data-vscode-theme-kind"]});
};

/** Follows a new `vscode-office.theme` value: `auto`, `light` or `dark`. */
export const setColorTheme = (vditor: IVditor, theme: string) => {
    vditor.options.colorTheme = normalizeColorTheme(theme);
    applyColorTheme(vditor);
};

/** Follows a new `vscode-office.markdown.theme` value: `auto`, `light` or `dark`. */
export const setPageTheme = (vditor: IVditor, theme: string) => {
    vditor.options.pageTheme = normalizeColorTheme(theme);
    applyColorTheme(vditor);
};

export const initColorTheme = (vditor: IVditor) => {
    vditor.options.colorTheme = normalizeColorTheme(vditor.options.colorTheme);
    vditor.options.pageTheme = normalizeColorTheme(vditor.options.pageTheme);
    applyColorTheme(vditor);
    observeVscodeTheme(vditor);
    initMobileOutlineMenu(vditor);
};
