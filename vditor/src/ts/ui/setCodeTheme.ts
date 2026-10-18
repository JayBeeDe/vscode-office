import {CM_THEME_ATTR, CM_THEME_AUTO, CM_THEME_IDS} from "./codeMirrorColorThemes";
import {getPageElements, isPageDark} from "./colorTheme";

export const normalizeCodeMirrorThemeId = (theme?: string) => {
    if (!theme || theme === "default") {
        return CM_THEME_AUTO;
    }
    return CM_THEME_IDS.includes(theme) ? theme : CM_THEME_AUTO;
};

/** The code blocks' theme setting: `auto`, `light` or `dark`. */
export const resolveCodeMirrorTheme = (options: {
    codeMirrorTheme?: string;
}) => {
    return normalizeCodeMirrorThemeId(options.codeMirrorTheme);
};

/** Shows the code blocks' colours on the page: `auto` is light or dark, following the page. */
export const setCodeTheme = (vditor: IVditor) => {
    const theme = resolveCodeMirrorTheme(vditor.options);
    const shown = theme === CM_THEME_AUTO ? (isPageDark(vditor) ? "dark" : "light") : theme;
    document.documentElement.setAttribute(CM_THEME_ATTR, shown);
    vditor.element.setAttribute(CM_THEME_ATTR, shown);
    for (const page of getPageElements(vditor)) {
        page.setAttribute(CM_THEME_ATTR, shown);
    }
};

export const applyCodeMirrorTheme = (vditor: IVditor, theme: string, notify = true) => {
    const resolved = normalizeCodeMirrorThemeId(theme);
    vditor.options.codeMirrorTheme = resolved;
    setCodeTheme(vditor);
    if (notify && vditor.options.changeCodeTheme) {
        vditor.options.changeCodeTheme(resolved);
    }
    return resolved;
};
