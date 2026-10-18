import * as vscode from 'vscode';
import { Global } from './global';
import { Handler } from './handler';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = typeof THEMES[number];

const isTheme = (value: unknown): value is Theme => (THEMES as readonly unknown[]).includes(value);

/** The `vscode-office.theme` setting, shared by every viewer and editor. */
export function getTheme(): Theme {
    const theme = Global.getConfig<string>('theme', 'auto');
    return isTheme(theme) ? theme : 'auto';
}

/**
 * Keeps the page's theme in sync: sends `theme` whenever the setting changes, and saves the
 * theme the page picks (the EPUB reader's "Themes" choice) in the user settings.
 */
export function bindTheme(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-office.theme')) {
            handler.emit('theme', getTheme());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
    handler.on('theme', async (theme: unknown) => {
        if (isTheme(theme)) {
            await Global.updateConfig('theme', theme);
        }
    });
}
