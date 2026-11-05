import MindElixir from 'mind-elixir';
import { getVscodeThemeColor } from '../../util/vscodeTheme';

const LAYOUT_VARS = {
    '--node-gap-x': '30px',
    '--node-gap-y': '10px',
    '--main-gap-x': '65px',
    '--main-gap-y': '45px',
    '--root-radius': '30px',
    '--main-radius': '20px',
    '--main-border': '',
    '--topic-padding': '3px',
    '--map-padding': '50px 80px',
} as const;

/** VS Code's accent, like the other viewers': its link color can be another hue. */
function vscodeAccent() {
    return getVscodeThemeColor('--vscode-focusBorder', getVscodeThemeColor('--vscode-textLink-foreground', '#1677ff'));
}

/**
 * The map's theme: the accent draws the lines (every branch, a single palette colour), the
 * borders and the selection, never the text.
 */
export function buildMindElixirTheme(adaptive: boolean) {
    const accent = vscodeAccent();

    if (!adaptive) {
        const baseTheme = MindElixir.THEME;
        return {
            ...baseTheme,
            name: 'VSCode Light',
            palette: [accent],
            cssVar: {
                ...baseTheme.cssVar,
                '--root-border-color': accent,
                '--selected': accent,
                '--accent-color': accent,
            },
        };
    }

    const baseTheme = MindElixir.DARK_THEME;
    const bg = getVscodeThemeColor('--vscode-editor-background', '#1e1e1e');
    const fg = getVscodeThemeColor('--vscode-editor-foreground', '#cccccc');
    const widgetBg = getVscodeThemeColor('--vscode-editorWidget-background', '#252526');
    const muted = getVscodeThemeColor('--vscode-descriptionForeground', '#999999');
    const border = getVscodeThemeColor('--vscode-editorWidget-border', '#454545');
    const rootBg = getVscodeThemeColor('--vscode-button-background', '#2d3748');
    const rootFg = getVscodeThemeColor('--vscode-button-foreground', '#ffffff');

    return {
        name: 'VSCode',
        type: 'dark' as const,
        palette: [accent],
        cssVar: {
            ...baseTheme.cssVar,
            ...LAYOUT_VARS,
            '--root-color': rootFg,
            '--root-bgcolor': rootBg,
            '--root-border-color': accent,
            '--main-color': fg,
            '--main-bgcolor': widgetBg,
            '--main-bgcolor-transparent': 'rgba(37, 37, 38, 0.8)',
            '--color': muted,
            '--bgcolor': bg,
            '--selected': accent,
            '--accent-color': accent,
            '--panel-color': fg,
            '--panel-bgcolor': widgetBg,
            '--panel-border-color': border,
        },
    };
}
