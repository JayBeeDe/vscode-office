export const MERMAID_THEME_ATTR = "data-mermaid-theme";
/** Light or dark, following the editor. */
export const MERMAID_THEME_AUTO = "auto";

export interface IMermaidThemeGroup {
    titleKey: string;
    themes: string[];
}

export const MERMAID_THEME_GROUPS: IMermaidThemeGroup[] = [
    {
        titleKey: "mermaid-theme-section-system",
        themes: [MERMAID_THEME_AUTO],
    },
    {
        titleKey: "mermaid-theme-section-light",
        themes: ["light", "light-forest", "light-ocean", "light-sunset"],
    },
    {
        titleKey: "mermaid-theme-section-dark",
        themes: ["dark", "dark-dracula"],
    },
];

export const MERMAID_THEME_IDS: string[] = MERMAID_THEME_GROUPS.flatMap((group) => group.themes);

export const MERMAID_FLOATING_PANEL_CLASS = "vditor-mermaid-theme-popover";
