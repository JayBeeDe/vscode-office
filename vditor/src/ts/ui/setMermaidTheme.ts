import {refreshMermaidTheme} from "../markdown/mermaidRender";
import {isPageDark} from "./colorTheme";
import {
    MERMAID_THEME_ATTR,
    MERMAID_THEME_AUTO,
    MERMAID_THEME_IDS,
} from "./mermaidThemeCatalog";

export const normalizeMermaidThemeId = (theme?: string) => {
    if (!theme || theme === "default") {
        return MERMAID_THEME_AUTO;
    }
    return MERMAID_THEME_IDS.includes(theme) ? theme : MERMAID_THEME_AUTO;
};

/** The diagrams' theme setting, `auto` included. */
export const resolveMermaidTheme = (options: {mermaidTheme?: string}) => {
    return normalizeMermaidThemeId(options.mermaidTheme);
};

/** The theme the diagrams show: `auto` is light or dark, following the page. */
export const shownMermaidTheme = (vditor: IVditor) => {
    const theme = resolveMermaidTheme(vditor.options);
    if (theme !== MERMAID_THEME_AUTO) {
        return theme;
    }
    return isPageDark(vditor) ? "dark" : "light";
};

/** Sets the shown theme on the editor and the diagrams. */
export const syncMermaidTheme = (vditor: IVditor) => {
    const shown = shownMermaidTheme(vditor);
    vditor.element.setAttribute(MERMAID_THEME_ATTR, shown);
    document.documentElement.setAttribute(MERMAID_THEME_ATTR, shown);
    for (const host of vditor.element.querySelectorAll(".vditor-mermaid-host")) {
        host.setAttribute(MERMAID_THEME_ATTR, shown);
    }
};

export const applyMermaidTheme = (vditor: IVditor, theme: string, notify = true) => {
    const resolved = normalizeMermaidThemeId(theme);
    vditor.options.mermaidTheme = resolved;
    syncMermaidTheme(vditor);
    refreshMermaidTheme(vditor.element, vditor.options.cdn, vditor);
    if (notify && vditor.options.changeMermaidTheme) {
        vditor.options.changeMermaidTheme(resolved);
    }
    return resolved;
};

export const initMermaidTheme = (vditor: IVditor) => {
    vditor.options.mermaidTheme = resolveMermaidTheme(vditor.options);
    syncMermaidTheme(vditor);
};
