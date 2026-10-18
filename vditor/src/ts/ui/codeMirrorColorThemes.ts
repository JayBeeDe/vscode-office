export const CM_THEME_ATTR = "data-cm-theme";
/** Light or dark, following the editor. */
export const CM_THEME_AUTO = "auto";

export interface ICodeMirrorThemeGroup {
    titleKey: string;
    themes: string[];
}

export const CM_THEME_GROUPS: ICodeMirrorThemeGroup[] = [
    {
        titleKey: "",
        themes: [CM_THEME_AUTO, "light", "dark"],
    },
];

export const CM_THEME_IDS: string[] = CM_THEME_GROUPS.flatMap((group) => group.themes);
