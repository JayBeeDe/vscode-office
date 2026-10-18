import { useSyncExternalStore } from 'react';
import { handler } from './vscode';
import { getConfigs } from './vscodeConfig';
import { isVscodeEditorDark } from './vscodeTheme';
import '../../../resource/theme/dark-palette.css';

/** The `vscode-office.theme` setting. */
export type ThemeSetting = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const SETTINGS: readonly string[] = ['auto', 'light', 'dark'];
export const toThemeSetting = (value: unknown): ThemeSetting => SETTINGS.includes(value as string) ? value as ThemeSetting : 'auto';

let setting = toThemeSetting(getConfigs()?.theme);
const listeners = new Set<() => void>();

/** VS Code's own kind: high contrast is dark, high contrast light is light. */
export function getVscodeTheme(): Theme {
    const kind = document.body.getAttribute('data-vscode-theme-kind')
        ?? ['vscode-high-contrast-light', 'vscode-light', 'vscode-high-contrast', 'vscode-dark']
            .find(name => document.body.classList.contains(name));
    if (kind === 'vscode-dark' || kind === 'vscode-high-contrast') {
        return 'dark';
    }
    if (kind === 'vscode-light' || kind === 'vscode-high-contrast-light') {
        return 'light';
    }
    return isVscodeEditorDark() ? 'dark' : 'light';
}

export function resolveTheme(value: ThemeSetting = setting): Theme {
    return value === 'auto' ? getVscodeTheme() : value;
}

/**
 * The page's classes: `office-dark` or `office-light`, and `office-forced-dark` when the page is
 * dark while VS Code is light: VS Code's colours are then light ones, and dark-palette.css
 * replaces them.
 */
function applyTheme() {
    const theme = resolveTheme();
    document.body.classList.toggle('office-dark', theme === 'dark');
    document.body.classList.toggle('office-light', theme === 'light');
    document.body.classList.toggle('office-forced-dark', theme === 'dark' && getVscodeTheme() === 'light');
}

let snapshot = '';
function update() {
    applyTheme();
    const next = `${setting}:${resolveTheme()}`;
    if (next !== snapshot) {
        snapshot = next;
        listeners.forEach(listener => listener());
    }
}

handler.on('theme', (value: unknown) => {
    setting = toThemeSetting(value);
    update();
});
// VS Code changes the body's classes and its colour variables when its theme changes
new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind'] });
update();

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** `light` or `dark`, following `vscode-office.theme` and, for `auto`, VS Code. */
export function useTheme(): Theme {
    return useSyncExternalStore(subscribe, () => resolveTheme());
}
