import * as vscode from 'vscode';
import { Handler } from './handler';
import { i18n } from './global';
import { getFileSuffix } from './fileSuffix';
import { resolveLanguage } from '../i18n';

/**
 * The loading screen every viewer shows while its document opens: a spinner over the whole
 * webview, in VS Code's colors, from the very first paint. The webview hides it with
 * `setDocumentLoading(false)` (resource/lib/vscode.js, src/react/util/vscode.ts), which also tells
 * the extension, so the status bar shows the load too.
 */
const OVERLAY_STYLE = `
#office-loading {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin: 0;
    background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-descriptionForeground, #9d9d9d);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: 13px;
    line-height: 1.4;
    opacity: 1;
    transition: opacity .15s ease;
}
#office-loading.office-loading--done {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity .15s ease, visibility 0s linear .15s;
}
#office-loading .office-loading__spinner {
    box-sizing: border-box;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid color-mix(in srgb, var(--vscode-progressBar-background, #0e70c0) 25%, transparent);
    border-top-color: var(--vscode-progressBar-background, #0e70c0);
    animation: office-loading-spin .8s linear infinite;
}
#office-loading .office-loading__label {
    max-width: 80vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
@keyframes office-loading-spin {
    to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
    #office-loading .office-loading__spinner { animation-duration: 2.4s; }
}`;

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function documentName(uri: vscode.Uri): string {
    const path = uri.path;
    return path.slice(path.lastIndexOf('/') + 1) || path;
}

/** The kind of document, by file suffix: every key written out, so the i18n check sees them. */
function documentKind(suffix: string): string {
    switch (suffix) {
        case '.xls': case '.xlt': case '.xlsx': case '.xlsm': case '.xltx': case '.xltm':
        case '.ods': case '.ots': case '.csv': case '.tsv':
            return i18n('loading.kind.spreadsheet');
        case '.docx': case '.docm': case '.dotx': case '.dotm':
            return i18n('loading.kind.document');
        case '.pptx': case '.pptm': case '.ppsx': case '.potx': case '.ppsm': case '.potm':
            return i18n('loading.kind.presentation');
        case '.pdf':
            return i18n('loading.kind.pdf');
        case '.epub':
            return i18n('loading.kind.epub');
        case '.xmind':
            return i18n('loading.kind.xmind');
        case '.parquet':
            return i18n('loading.kind.parquet');
        case '.md': case '.markdown':
            return i18n('loading.kind.markdown');
        default:
            return i18n('loading.kind.file');
    }
}

/** "Loading spreadsheet excel.csv...": the kind of document, then its file name. */
function loadingLabel(uri: vscode.Uri): string {
    const name = documentName(uri);
    return i18n('loading.document', { kind: documentKind(getFileSuffix(name)), name });
}

/** "Saving spreadsheet excel.csv...": the kind of document, then its file name. */
function savingLabel(uri: vscode.Uri): string {
    const name = documentName(uri);
    return i18n('saving.document', { kind: documentKind(getFileSuffix(name)), name });
}

/** The webview's HTML with the loading screen as the first thing of its body. */
export function withLoadingOverlay(html: string, uri: vscode.Uri): string {
    const label = escapeHtml(loadingLabel(uri));
    const overlay = `<style>${OVERLAY_STYLE}</style>`
        + `<div id="office-loading" role="status" aria-live="polite">`
        + `<div class="office-loading__spinner"></div>`
        + `<div class="office-loading__label">${label}</div>`
        + `</div>`;
    return html.replace(/<body\b[^>]*>/i, (body) => body + overlay);
}

/**
 * Shows the document's load in the status bar: from now until the webview reports it is done,
 * and again each time it reloads the document (the file changed on disk).
 */
export function trackDocumentLoading(handler: Handler, uri: vscode.Uri): void {
    const title = loadingLabel(uri);
    let finish: (() => void) | undefined;
    const start = () => {
        if (finish || handler.disposed) return;
        const done = new Promise<void>(resolve => { finish = resolve; });
        void vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title }, () => done);
    };
    const end = () => {
        finish?.();
        finish = undefined;
    };
    start();
    handler.on('loadingState', (loading: boolean) => loading ? start() : end());
    handler.panel.onDidDispose(end);
}

/**
 * "Loading 3 remaining Mermaid diagrams of Markdown notes.md...": the plural form the language uses
 * for that number (every form written out, so the i18n check sees them).
 */
function mermaidLoadingLabel(uri: vscode.Uri, count: number): string {
    const name = documentName(uri);
    const vars = { count, kind: documentKind(getFileSuffix(name)), name };
    switch (new Intl.PluralRules(resolveLanguage(vscode.env.language)).select(count)) {
        case 'one': return i18n('loading.mermaid.one', vars);
        case 'few': return i18n('loading.mermaid.few', vars);
        case 'many': return i18n('loading.mermaid.many', vars);
        default: return i18n('loading.mermaid.other', vars);
    }
}

/**
 * The markdown editor reports the Mermaid diagrams it has left to draw (`mermaidLoading`): the
 * status bar shows how many while there are some, and the editor gets the same text back
 * (`mermaidLoadingLabel`) for the diagrams' spinners. Empty once they are all drawn.
 */
export function trackMermaidLoading(handler: Handler, uri: vscode.Uri): void {
    let label = '';
    let finish: (() => void) | undefined;
    let report: ((message: string) => void) | undefined;
    const end = () => {
        finish?.();
        finish = undefined;
        report = undefined;
    };
    handler.on('mermaidLoading', (remaining: number) => {
        label = remaining > 0 ? mermaidLoadingLabel(uri, remaining) : '';
        handler.emit('mermaidLoadingLabel', label);
        if (!label) {
            end();
        } else if (report) {
            report(label);
        } else if (!finish && !handler.disposed) {
            const done = new Promise<void>(resolve => { finish = resolve; });
            void vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, (progress) => {
                report = (message) => progress.report({ message });
                report(label);
                return done;
            });
        }
    });
    handler.panel.onDidDispose(end);
}

/** the shortest time the "Saving..." text stays in the status bar, so a quick save can be read */
const MIN_SAVING_MS = 1200;

interface SavingState {
    /** saves running for this panel */
    count: number;
    shownAt: number;
    /** ends the status bar progress */
    finish?: () => void;
    /** ends the save the viewer reported while building the file's content */
    endViewer?: () => void;
}

const savingStates = new WeakMap<Handler, SavingState>();

function savingState(handler: Handler): SavingState {
    let state = savingStates.get(handler);
    if (!state) {
        state = { count: 0, shownAt: 0 };
        savingStates.set(handler, state);
    }
    return state;
}

/**
 * Shows "Saving spreadsheet test.csv..." in the status bar until the returned function is
 * called. Saves can nest (a toolbar save runs VS Code's save): the text goes away when the last
 * one ends, and stays up at least MIN_SAVING_MS.
 */
export function beginDocumentSaving(handler: Handler | undefined, uri: vscode.Uri): () => void {
    if (!handler || handler.disposed) return () => { };
    const state = savingState(handler);
    state.count++;
    if (!state.finish) {
        state.shownAt = Date.now();
        const done = new Promise<void>(resolve => { state.finish = resolve; });
        void vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: savingLabel(uri) }, () => done);
    }
    let ended = false;
    return () => {
        if (ended) return;
        ended = true;
        state.count--;
        if (state.count > 0) return;
        const finish = state.finish;
        setTimeout(() => {
            // a new save started meanwhile keeps the progress
            if (state.count > 0 || state.finish !== finish) return;
            state.finish = undefined;
            finish?.();
        }, Math.max(0, state.shownAt + MIN_SAVING_MS - Date.now()));
    };
}

/**
 * The viewer reports it builds the file's content (`saving` true), which can take long, or that
 * it failed (false). The write that follows ends it, or `endViewerSaving` when none follows.
 */
export function trackViewerSaving(handler: Handler, uri: vscode.Uri): void {
    handler.on('saving', (saving: boolean) => {
        const state = savingState(handler);
        if (!saving) {
            endViewerSaving(handler);
        } else if (!state.endViewer) {
            state.endViewer = beginDocumentSaving(handler, uri);
        }
    });
}

/** Ends the save the viewer reported: its file is written, or there is nothing to write. */
export function endViewerSaving(handler: Handler | undefined): void {
    const state = handler && savingStates.get(handler);
    const end = state?.endViewer;
    if (!state || !end) return;
    state.endViewer = undefined;
    end();
}

/** Shows the save of a text document (markdown), from VS Code's will-save to its did-save. */
export function trackTextDocumentSaving(handler: Handler, uri: vscode.Uri): vscode.Disposable {
    const key = uri.toString();
    let end: (() => void) | undefined;
    let safety: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        clearTimeout(safety);
        end?.();
        end = undefined;
    };
    const disposables = [
        vscode.workspace.onWillSaveTextDocument(e => {
            if (e.document.uri.toString() !== key || end) return;
            end = beginDocumentSaving(handler, uri);
            // a save that fails fires no did-save
            safety = setTimeout(stop, 30_000);
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.uri.toString() === key) stop();
        }),
    ];
    return new vscode.Disposable(() => {
        stop();
        disposables.forEach(d => d.dispose());
    });
}
