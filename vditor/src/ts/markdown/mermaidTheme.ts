interface IMermaidThemePalette {
    background: string;
    panel: string;
    foreground: string;
    muted: string;
    border: string;
    accent: string;
    secondary: string;
    tertiary: string;
    note: string;
    warning: string;
    error: string;
    darkMode?: boolean;
}

const CUSTOM_MERMAID_THEMES: Record<string, IMermaidThemePalette> = {
    "light-ocean": {
        background: "#f3fbff",
        panel: "#ffffff",
        foreground: "#183042",
        muted: "#5c7485",
        border: "#9bc9dc",
        accent: "#147fb5",
        secondary: "#53c2c5",
        tertiary: "#8ea7ff",
        note: "#d9f3ff",
        warning: "#f2b84b",
        error: "#d25b6a",
    },
    "light-sunset": {
        background: "#fff8f0",
        panel: "#ffffff",
        foreground: "#3d261f",
        muted: "#8a6556",
        border: "#e3b69b",
        accent: "#d96c2c",
        secondary: "#f0a03f",
        tertiary: "#c46fa1",
        note: "#ffe4bd",
        warning: "#d99b25",
        error: "#c24645",
    },
    "dark-dracula": {
        background: "#282a36",
        panel: "#343746",
        foreground: "#f8f8f2",
        muted: "#bdc1d6",
        border: "#6272a4",
        accent: "#bd93f9",
        secondary: "#8be9fd",
        tertiary: "#ff79c6",
        note: "#44475a",
        warning: "#f1fa8c",
        error: "#ff5555",
        darkMode: true,
    },
};

const parseRgb = (color: string): [number, number, number] | null => {
    const value = color.trim();
    if (!value) {
        return null;
    }
    if (value.startsWith("#")) {
        const hex = value.slice(1);
        if (hex.length === 3) {
            return [
                parseInt(hex[0] + hex[0], 16),
                parseInt(hex[1] + hex[1], 16),
                parseInt(hex[2] + hex[2], 16),
            ];
        }
        if (hex.length >= 6) {
            return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16),
            ];
        }
    }
    const rgbMatch = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgbMatch) {
        return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
    }
    return null;
};

export const isDarkBackground = (color: string): boolean => {
    const rgb = parseRgb(color);
    if (!rgb) {
        return false;
    }
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return luminance < 0.5;
};

export const findVditorRoot = (element: HTMLElement): HTMLElement => {
    const vditor = element.closest("#vditor") as HTMLElement | null;
    return vditor ?? element;
};

/** Mermaid's settings for a theme id of mermaidThemeCatalog (never `auto`, resolved before). */
export const buildMermaidInitConfig = (themeId: string) => {
    if (themeId === "dark") {
        return { theme: "dark" };
    }
    if (themeId === "light-forest") {
        return { theme: "forest" };
    }
    const customTheme = CUSTOM_MERMAID_THEMES[themeId];
    if (customTheme) {
        return buildCustomMermaidThemeConfig(customTheme);
    }
    return { theme: "default" };
};

const buildCustomMermaidThemeConfig = (palette: IMermaidThemePalette) => {
    const contrastColor = (bg: string): string => isDarkBackground(bg) ? "#ffffff" : "#1f2020";
    const dark = palette.darkMode ?? isDarkBackground(palette.background);
    const noteText = contrastColor(palette.note);

    return {
        theme: "base",
        themeVariables: {
            activationBkgColor: palette.accent,
            activationBorderColor: palette.accent,
            activeTaskBkgColor: palette.accent,
            activeTaskBorderColor: palette.accent,
            actorBkg: palette.panel,
            actorBorder: palette.accent,
            actorLineColor: palette.muted,
            actorTextColor: palette.foreground,
            altBackground: palette.note,
            altSectionBkgColor: palette.warning,
            arrowheadColor: palette.muted,
            background: palette.background,
            border1: palette.accent,
            border2: palette.border,
            classText: palette.foreground,
            clusterBkg: palette.tertiary,
            clusterTextColor: contrastColor(palette.tertiary),
            clusterBorder: palette.accent,
            critBkgColor: palette.error,
            critBorderColor: palette.error,
            darkMode: dark,
            defaultLinkColor: palette.accent,
            doneTaskBkgColor: palette.muted,
            doneTaskBorderColor: palette.border,
            edgeLabelBackground: palette.background,
            errorBkgColor: palette.error,
            errorTextColor: contrastColor(palette.error),
            fillType0: palette.panel,
            fillType1: palette.accent,
            fillType2: palette.tertiary,
            fillType3: palette.secondary,
            fillType4: palette.note,
            fillType5: palette.warning,
            fillType6: palette.error,
            fillType7: palette.tertiary,
            fontFamily: "sans-serif",
            fontSize: "16px",
            gridColor: palette.border,
            labelBackground: palette.background,
            labelBoxBkgColor: palette.panel,
            labelBoxBorderColor: palette.accent,
            labelColor: palette.foreground,
            labelTextColor: palette.foreground,
            lineColor: palette.muted,
            loopTextColor: palette.warning,
            mainBkg: palette.panel,
            mainContrastColor: palette.foreground,
            nodeBkg: palette.panel,
            nodeBorder: palette.accent,
            noteBkgColor: palette.note,
            noteBorderColor: palette.warning,
            noteTextColor: noteText,
            primaryBorderColor: palette.accent,
            primaryColor: palette.panel,
            primaryTextColor: palette.foreground,
            secondBkg: palette.secondary,
            secondaryBorderColor: palette.accent,
            secondaryColor: palette.accent,
            secondaryTextColor: contrastColor(palette.accent),
            sectionBkgColor: palette.note,
            sectionBkgColor2: palette.warning,
            sequenceNumberColor: contrastColor(palette.accent),
            signalColor: palette.accent,
            signalTextColor: palette.foreground,
            taskBkgColor: palette.secondary,
            taskBorderColor: palette.accent,
            taskTextClickableColor: palette.accent,
            taskTextColor: contrastColor(palette.secondary),
            taskTextDarkColor: "#1f2020",
            taskTextLightColor: "#ffffff",
            taskTextOutsideColor: palette.foreground,
            tertiaryBorderColor: palette.tertiary,
            tertiaryColor: palette.tertiary,
            tertiaryTextColor: contrastColor(palette.tertiary),
            textColor: palette.foreground,
            titleColor: palette.accent,
            todayLineColor: palette.error,
        },
    };
};
