import * as vscode from 'vscode';
import { Global } from './global';
import { Handler } from './handler';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = typeof THEMES[number];

const isTheme = (value: unknown): value is Theme => (THEMES as readonly unknown[]).includes(value);

function readTheme(key: string): Theme {
    const theme = Global.getConfig<string>(key, 'auto');
    return isTheme(theme) ? theme : 'auto';
}

/** The `vscode-office.theme` setting, shared by every viewer and editor. */
export function getTheme(): Theme {
    return readTheme('theme');
}

/** The `vscode-office.epub.theme` setting: the EPUB pages' colours, `auto` following `vscode-office.theme`. */
export function getEpubTheme(): Theme {
    return readTheme('epub.theme');
}

/** The `vscode-office.document.theme` setting: the document pages' colours, `auto` following `vscode-office.theme`. */
export function getDocumentTheme(): Theme {
    return readTheme('document.theme');
}

/** The `vscode-office.pdf.theme` setting: the PDF pages' colours, `auto` following `vscode-office.theme`. */
export function getPdfTheme(): Theme {
    return readTheme('pdf.theme');
}

/** Sends `theme` to the page whenever `vscode-office.theme` changes. */
export function bindTheme(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-office.theme')) {
            handler.emit('theme', getTheme());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
}

/**
 * Keeps a viewer's page theme in sync: sends `event` whenever the `vscode-office.<key>` setting
 * changes, and saves the theme the viewer picks (an `event` it sends) in the user settings.
 */
function bindPageTheme(handler: Handler, key: string, event: string) {
    const subscription = vscode.workspace.onDidChangeConfiguration((change) => {
        if (change.affectsConfiguration(`vscode-office.${key}`)) {
            handler.emit(event, readTheme(key));
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
    handler.on(event, async (theme: unknown) => {
        if (isTheme(theme)) {
            await Global.updateConfig(key, theme);
        }
    });
}

/** The document editor's page theme, `documentTheme`: its toolbar's light/dark button sets it. */
export function bindDocumentTheme(handler: Handler) {
    bindPageTheme(handler, 'document.theme', 'documentTheme');
}

/** The EPUB reader's page theme, `epubTheme`: its "Themes" choice sets it. */
export function bindEpubTheme(handler: Handler) {
    bindPageTheme(handler, 'epub.theme', 'epubTheme');
}

/** The PDF viewer's page theme, `pdfTheme`: its dark mode button and Ctrl/Cmd+L set it. */
export function bindPdfTheme(handler: Handler) {
    bindPageTheme(handler, 'pdf.theme', 'pdfTheme');
}
