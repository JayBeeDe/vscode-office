/**
 * A button's tooltip with its keyboard shortcut: "Save (Ctrl+S)". The key names are the same in
 * every language, like the editors' own tooltips.
 */
export const withShortcut = (label: string, shortcut: string) => `${label} (${shortcut})`;
