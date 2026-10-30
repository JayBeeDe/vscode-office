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
 * Keeps the document editor's page theme in sync: sends `documentTheme` whenever the setting
 * changes, and saves the theme the toolbar's light/dark button picks in the user settings.
 */
export function bindDocumentTheme(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-office.document.theme')) {
            handler.emit('documentTheme', getDocumentTheme());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
    handler.on('documentTheme', async (theme: unknown) => {
        if (isTheme(theme)) {
            await Global.updateConfig('document.theme', theme);
        }
    });
}

/**
 * Keeps the EPUB reader's page theme in sync: sends `epubTheme` whenever the setting changes, and
 * saves the theme the reader's "Themes" choice picks in the user settings.
 */
export function bindEpubTheme(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-office.epub.theme')) {
            handler.emit('epubTheme', getEpubTheme());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
    handler.on('epubTheme', async (theme: unknown) => {
        if (isTheme(theme)) {
            await Global.updateConfig('epub.theme', theme);
        }
    });
}
