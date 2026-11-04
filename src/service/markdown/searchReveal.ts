import * as vscode from 'vscode';
import { MARKDOWN_EXTENSIONS } from './wikilink/constants';
import { getMarkdownWebviewHandler, markdownUriKey } from './blockScroll';

/**
 * Opens search results in the Markdown editor, at the match (`vscode-office.markdown.openSearchResults`).
 *
 * VS Code doesn't tell a custom editor where to open: a Search view click only reaches a text
 * editor. So when the setting is on, Markdown files open as text (user `workbench.editorAssociations`
 * entries this adds, and removes when it is turned off), where VS Code selects the match, and this
 * reopens them in the Markdown editor, its find bar on the same occurrence. Text editors asked for
 * on purpose (the editor's "Edit in VS Code", a diff, the user's own associations) stay.
 */

/** The occurrence the Markdown editor shows, sent with `open` or as `revealMatch`. */
export interface MarkdownMatch {
    /** the selected text, which the editor's find bar searches */
    text: string;
    /** how many times `text` occurs, ignoring case, in the Markdown source before the match */
    occurrence: number;
}

const SCHEMES = new Set(['file', 'vscode-vfs', 'vscode-remote']);
const SETTING = 'markdown.openSearchResults';
/** the associations that open Markdown files as text while the setting is on */
const ASSOCIATIONS = ['*.md', '*.markdown'];
/** global state: the associations this added, removed when the setting is turned off */
const ADDED_ASSOCIATIONS_KEY = 'markdownSearchResultAssociations';

let addedAssociations: string[] = [];

/** the files whose text editor was asked for: they are not reopened in the Markdown editor */
const keptAsText = new Set<string>();
const pendingMatches = new Map<string, MarkdownMatch>();

/** Opens `uri` in a text editor and keeps it there, for "Edit in VS Code". */
export function openMarkdownAsText(uri: vscode.Uri, column: vscode.ViewColumn) {
    keptAsText.add(markdownUriKey(uri));
    return vscode.commands.executeCommand('vscode.openWith', uri, 'default', column);
}

/** Opens `uri` in the Markdown editor when it is a Markdown file, else in its default editor. */
export function openInEditor(uri: vscode.Uri) {
    if (isMarkdownFile(uri)) {
        return vscode.commands.executeCommand('vscode.openWith', uri, 'cweijan.markdownViewer', { preview: false });
    }
    return vscode.commands.executeCommand('vscode.open', uri, { preview: false });
}

/** The match the Markdown editor opening `uri` shows, once. */
export function consumePendingMatch(uri: vscode.Uri): MarkdownMatch | undefined {
    const key = markdownUriKey(uri);
    const match = pendingMatches.get(key);
    pendingMatches.delete(key);
    return match;
}

function isMarkdownFile(uri: vscode.Uri): boolean {
    const path = uri.path.toLowerCase();
    return SCHEMES.has(uri.scheme) && MARKDOWN_EXTENSIONS.some(ext => path.endsWith(ext));
}

/** Whether the user's `workbench.editorAssociations` sends the file to another editor. */
function isAssociatedElsewhere(uri: vscode.Uri): boolean {
    const associations = vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations') ?? {};
    const name = uri.path.slice(uri.path.lastIndexOf('/') + 1).toLowerCase();
    return Object.entries(associations).some(([pattern, viewType]) => {
        if (viewType === 'cweijan.markdownViewer' || (addedAssociations.includes(pattern) && viewType === 'default')) {
            return false;
        }
        const glob = pattern.toLowerCase().replace(/^.*\//, '');
        const source = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp(`^${source}$`).test(name);
    });
}

/** The selected text, as the Search view selects a result, and where it is among its occurrences. */
function selectedMatch(editor: vscode.TextEditor): MarkdownMatch | undefined {
    const { document, selection } = editor;
    if (selection.isEmpty || !selection.isSingleLine) {
        return undefined;
    }
    const text = document.getText(selection);
    const needle = text.toLowerCase();
    const before = document.getText(new vscode.Range(new vscode.Position(0, 0), selection.start)).toLowerCase();
    let occurrence = 0;
    for (let index = before.indexOf(needle); index >= 0; index = before.indexOf(needle, index + needle.length)) {
        occurrence++;
    }
    return { text, occurrence };
}

function isEnabled(): boolean {
    return vscode.workspace.getConfiguration('vscode-office').get<boolean>(SETTING, false);
}

/**
 * Adds the text editor associations while the setting is on, and removes those it added once it
 * is off; an association the user wrote is left alone.
 */
async function syncAssociations(context: vscode.ExtensionContext) {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const current = { ...(workbench.inspect<Record<string, string>>('editorAssociations')?.globalValue ?? {}) };
    let changed = false;
    if (isEnabled()) {
        for (const pattern of ASSOCIATIONS) {
            if (current[pattern] === undefined) {
                current[pattern] = 'default';
                addedAssociations.push(pattern);
                changed = true;
            }
        }
    } else {
        for (const pattern of addedAssociations) {
            if (current[pattern] === 'default') {
                delete current[pattern];
                changed = true;
            }
        }
        addedAssociations = [];
    }
    await context.globalState.update(ADDED_ASSOCIATIONS_KEY, addedAssociations);
    if (changed) {
        await workbench.update('editorAssociations', Object.keys(current).length ? current : undefined, vscode.ConfigurationTarget.Global);
    }
}

async function reopenInMarkdownEditor(editor: vscode.TextEditor) {
    const { document } = editor;
    const key = markdownUriKey(document.uri);
    if (!isEnabled() || keptAsText.has(key) || !isMarkdownFile(document.uri) || isAssociatedElsewhere(document.uri)) {
        return;
    }
    // only a text editor of its own: not a diff, nor a text editor in another group
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    if (!(tab?.input instanceof vscode.TabInputText) || markdownUriKey(tab.input.uri) !== key) {
        return;
    }
    const match = selectedMatch(editor);
    const handler = getMarkdownWebviewHandler(document.uri);
    if (match && !handler) {
        pendingMatches.set(key, match);
    }
    // the text editor saves its view state when it closes: at the top, so that the next opening
    // doesn't take this match for a search result
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('vscode.openWith', document.uri, 'cweijan.markdownViewer', {
        viewColumn: group.viewColumn,
        preview: tab.isPreview,
    });
    try {
        await vscode.window.tabGroups.close(tab, true);
    } catch {
        // already closed: a preview tab is replaced by the next one
    }
    if (match && handler) {
        handler.emit('revealMatch', match);
    }
}

export function bindMarkdownSearchReveal(context: vscode.ExtensionContext) {
    addedAssociations = context.globalState.get<string[]>(ADDED_ASSOCIATIONS_KEY, []);
    void syncAssociations(context);
    let timer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(`vscode-office.${SETTING}`)) {
                void syncAssociations(context);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (timer) clearTimeout(timer);
            if (!editor) return;
            // the Search view selects the match just after the editor shows
            timer = setTimeout(() => {
                timer = undefined;
                if (vscode.window.activeTextEditor === editor) {
                    void reopenInMarkdownEditor(editor);
                }
            }, 50);
        }),
        // a text editor asked for, once closed: the next opening goes to the Markdown editor again
        vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
            for (const tab of closed) {
                if (tab.input instanceof vscode.TabInputText) {
                    keptAsText.delete(markdownUriKey(tab.input.uri));
                }
            }
        }),
    );
}
