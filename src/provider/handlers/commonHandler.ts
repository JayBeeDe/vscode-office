import * as vscode from 'vscode';
import { join, parse } from 'path';
import { Handler } from "@/common/handler";
import { isUriReadOnly } from '@/common/fileReadOnly';
import { Uri, workspace } from 'vscode';
import { i18n } from '@/common/global';
import { openInEditor } from '@/service/markdown/searchReveal';
import { emitFileOfficeOpen, emitVirtualOfficeOpen, isVirtualUri } from '@/provider/handlers/officeContent';
import { OfficeDocument } from '@/provider/handlers/officeDocument';

const fileSaveTimes: Record<string, number> = {};
const INTERNAL_SAVE_CHANGE_WINDOW_MS = 1500;

function buildDefaultXlsxUri(uri: Uri): Uri {
    const { dir, name } = parse(uri.fsPath);
    const fileName = `${name}.xlsx`;
    if (uri.scheme === 'file') {
        return Uri.file(join(dir, fileName));
    }
    return Uri.joinPath(uri, '..', fileName);
}

const SAFE_LINK_SCHEME = /^(https?|mailto):/i;
const LINK_SCHEME = /^[a-z][a-z0-9+.-]+:/i;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;

async function openLink(documentUri: Uri, link: string) {
    const url = link.trim();
    if (!url) {
        return;
    }
    if (SAFE_LINK_SCHEME.test(url)) {
        await vscode.env.openExternal(Uri.parse(url));
        return;
    }
    if (!LINK_SCHEME.test(url) && !WINDOWS_PATH.test(url) && !url.startsWith('\\\\')) {
        // relative link: resolve it against the document's folder and open it in the editor
        const path = url.replace(/[#?].*$/, '').replace(/\\/g, '/');
        if (path) {
            let decoded = path;
            try {
                decoded = decodeURIComponent(path);
            } catch {
                // keep the raw path
            }
            await openInEditor(Uri.joinPath(documentUri, '..', decoded));
        }
        return;
    }
    const open = i18n('common.openLink');
    const choice = await vscode.window.showWarningMessage(i18n('common.confirmOpenLink', { url }), { modal: true }, open);
    if (choice !== open) {
        return;
    }
    const target = LINK_SCHEME.test(url) && !WINDOWS_PATH.test(url) ? Uri.parse(url) : Uri.file(url);
    await vscode.env.openExternal(target);
}

export function shouldSkipFileChange(uri: Uri): boolean {
    const lastSaveTime = fileSaveTimes[uri.toString()];
    return !!(lastSaveTime && Date.now() - lastSaveTime < INTERNAL_SAVE_CHANGE_WINDOW_MS);
}

/** The Save As dialog's file type: its label is translated (host.saveAs.filter.<ext>). */
const SAVE_AS_FILTERS: Record<string, () => string> = {
    xlsx: () => i18n('saveAs.filter.xlsx'),
    xlsm: () => i18n('saveAs.filter.xlsm'),
    xltx: () => i18n('saveAs.filter.xltx'),
    xltm: () => i18n('saveAs.filter.xltm'),
    xls: () => i18n('saveAs.filter.xls'),
    xlt: () => i18n('saveAs.filter.xlt'),
    ods: () => i18n('saveAs.filter.ods'),
    ots: () => i18n('saveAs.filter.ots'),
    csv: () => i18n('saveAs.filter.csv'),
    parquet: () => i18n('saveAs.filter.parquet'),
    docx: () => i18n('saveAs.filter.docx'),
    docm: () => i18n('saveAs.filter.docm'),
    dotm: () => i18n('saveAs.filter.dotm'),
    dotx: () => i18n('saveAs.filter.dotx'),
};

/** Ask for a target file and write `content` there; returns false when the user cancels. */
async function saveContentAs(document: OfficeDocument, content: Uint8Array, targetExt?: string): Promise<boolean> {
    const { uri, handler } = document;
    const { dir, name, ext: sourceExt } = parse(uri.fsPath);
    const ext = (targetExt || sourceExt.replace(/^\./, '') || 'xlsx').toLowerCase();
    const defaultFileName = `${name}.${ext}`;
    // a read-only source such as a git revision is saved as a regular file next to the original
    const defaultUri = uri.scheme === 'file' || uri.scheme === 'git'
        ? Uri.file(join(dir, defaultFileName))
        : Uri.joinPath(uri, '..', defaultFileName);
    const label = SAVE_AS_FILTERS[ext]?.() ?? i18n('saveAs.filter.other', { ext: ext.toUpperCase() });
    const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { [label]: [ext] },
    });
    if (!target) {
        handler?.emit('saveFailed');
        return false;
    }
    fileSaveTimes[target.toString()] = Date.now();
    await writeOrReport(document, target, content);
    fileSaveTimes[target.toString()] = Date.now();
    // the document itself is not saved by a Save As
    handler?.emit("saveAsDone");
    await vscode.commands.executeCommand('vscode.openWith', target, 'cweijan.officeViewer');
    return true;
}

/** Write the file; on failure tell the webview, so it doesn't stay in a saving state. */
async function writeOrReport(document: OfficeDocument, target: Uri, content: Uint8Array) {
    try {
        await workspace.fs.writeFile(target, content);
    } catch (error) {
        document.handler?.emit('saveFailed', { message: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

async function writeDocument(document: OfficeDocument, content: Uint8Array) {
    const { uri, handler } = document;
    if (document.readOnly) {
        // the file can't be written: save a copy instead
        if (!await saveContentAs(document, content)) {
            throw new vscode.CancellationError();
        }
        document.dirty = false;
        handler?.emit('saveDone');
        return;
    }
    fileSaveTimes[uri.toString()] = Date.now();
    await writeOrReport(document, uri, content);
    fileSaveTimes[uri.toString()] = Date.now();
    document.dirty = false;
    handler?.emit('saveDone');
}

/** Called by VS Code when it saves the document (Ctrl+S, save on close, auto save). */
export async function saveOfficeDocument(document: OfficeDocument) {
    const content = document.pendingContent ?? await document.requestContent(false);
    document.pendingContent = undefined;
    await writeDocument(document, content);
}

/** Called by VS Code for File > Save As. */
export async function saveOfficeDocumentAs(document: OfficeDocument, target: Uri) {
    const content = await document.requestContent(false);
    fileSaveTimes[target.toString()] = Date.now();
    await writeOrReport(document, target, content);
}

export async function revertOfficeDocument(document: OfficeDocument) {
    document.dirty = false;
    document.pendingContent = undefined;
    await document.reload?.(true);
}

/** Run the save through VS Code so that it knows the document is no longer dirty. */
async function saveInEditor(document: OfficeDocument, handler: Handler) {
    const save = (workspace as { save?: (uri: Uri) => Thenable<Uri | undefined> }).save;
    if (typeof save === 'function') {
        await save(document.uri);
        return;
    }
    handler.panel.reveal();
    await vscode.commands.executeCommand('workbench.action.files.save');
}

export function handleCommonEvent(document: OfficeDocument, handler: Handler) {
    const uri = document.uri;
    document.handler = handler;
    let restoreBackup = !!document.backupUri;
    const send = async (force = false) => {
        if (!force && (shouldSkipFileChange(uri) || document.dirty)) {
            // keep unsaved edits when the file changes on disk
            return;
        }
        document.readOnly = await isUriReadOnly(uri);
        // the panel may have been closed while awaiting
        if (handler.disposed) {
            return;
        }
        if (restoreBackup && document.backupUri) {
            restoreBackup = false;
            void emitVirtualOfficeOpen(handler, uri, document.backupUri);
            return;
        }
        if (isVirtualUri(uri)) {
            void emitVirtualOfficeOpen(handler, uri);
            return;
        }
        await emitFileOfficeOpen(handler, uri, handler.panel.webview);
    }
    document.reload = send;
    handler
        .on("editInVSCode", (full: boolean) => {
            const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
            vscode.commands.executeCommand('vscode.openWith', uri, "default", side);
        })
        // the skip window only filters our own writes reported by the file watcher; a new panel always loads
        .on("init", () => { void send(true); })
        .on("fileChange", () => { void send(); })
        .on("change", () => {
            document.markDirty();
        })
        .on("save", async (content) => {
            const res = Array.isArray(content) ? new Uint8Array(content) : new TextEncoder().encode(content)
            if (document.resolveRequest(res)) {
                return;
            }
            // the webview saved on its own (a toolbar button): let VS Code run the save
            document.pendingContent = res;
            await saveInEditor(document, handler);
            if (document.pendingContent) {
                // VS Code did not save it, because the document was not dirty
                document.pendingContent = undefined;
                await writeDocument(document, res);
            }
        })
        .on("saveRequestDone", () => {
            // the webview finished without sending content: the user cancelled, or chose Save As
            document.cancelRequest();
        })
        .on("saveAs", async (payload: { content: number[], ext?: string }) => {
            document.cancelRequest();
            await saveContentAs(document, new Uint8Array(payload.content), payload.ext);
        })
        .on('developerTool', () => vscode.commands.executeCommand('workbench.action.toggleDevTools'))
        .on('openExternal', (url: string) => {
            if (url) {
                void openLink(uri, url);
            }
        })
        .on('dispose', () => {
            delete fileSaveTimes[uri.toString()];
        })
}
