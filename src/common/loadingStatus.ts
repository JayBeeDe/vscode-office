import * as vscode from 'vscode';
import { Handler } from './handler';
import { i18n } from './global';
import { getFileSuffix } from './fileSuffix';

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
