import * as vscode from 'vscode';
import { join, parse } from 'path';
import { Handler } from "@/common/handler";
import { isUriReadOnly } from '@/common/fileReadOnly';
import { Uri, workspace } from 'vscode';
import { i18n } from '@/common/global';
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
            await vscode.commands.executeCommand('vscode.open', Uri.joinPath(documentUri, '..', decoded));
        }
        return;
    }
    const open = i18n('ext.office.openLink');
    const choice = await vscode.window.showWarningMessage(i18n('ext.office.confirmOpenLink', url), { modal: true }, open);
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

const SAVE_AS_FILTERS: Record<string, { label: string; exts: string[] }> = {
    xlsx: { label: 'Excel Workbook', exts: ['xlsx'] },
    xlsm: { label: 'Excel Macro-Enabled Workbook', exts: ['xlsm'] },
    xltx: { label: 'Spreadsheet Template', exts: ['xltx'] },
    xltm: { label: 'Macro-Enabled Spreadsheet Template', exts: ['xltm'] },
    xls: { label: 'Excel 97-2003 Workbook', exts: ['xls'] },
    xlt: { label: 'Spreadsheet 97-2003 Template', exts: ['xlt'] },
    ods: { label: 'OpenDocument Spreadsheet', exts: ['ods'] },
    ots: { label: 'OpenDocument Spreadsheet Template', exts: ['ots'] },
    csv: { label: 'CSV (Comma delimited)', exts: ['csv'] },
    parquet: { label: 'Apache Parquet', exts: ['parquet'] },
    docx: { label: 'Word Document', exts: ['docx'] },
    docm: { label: 'Macro-Enabled Document', exts: ['docm'] },
    dotm: { label: 'Macro-Enabled Document Template', exts: ['dotm'] },
    dotx: { label: 'Word Template', exts: ['dotx'] },
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
    const info = SAVE_AS_FILTERS[ext] ?? { label: ext.toUpperCase(), exts: [ext] };
    const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { [info.label]: info.exts },
    });
    if (!target) return false;
    fileSaveTimes[target.toString()] = Date.now();
    await workspace.fs.writeFile(target, content);
    fileSaveTimes[target.toString()] = Date.now();
    handler?.emit("saveDone");
    await vscode.commands.executeCommand('vscode.openWith', target, 'cweijan.officeViewer');
    return true;
}

async function writeDocument(document: OfficeDocument, content: Uint8Array) {
    const { uri, handler } = document;
    if (document.readOnly) {
        // the file can't be written: save a copy instead
        if (!await saveContentAs(document, content)) {
            throw new vscode.CancellationError();
        }
        document.dirty = false;
        return;
    }
    fileSaveTimes[uri.toString()] = Date.now();
    await workspace.fs.writeFile(uri, content);
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
    await workspace.fs.writeFile(target, content);
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
        .on("init", () => { void send(); })
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
        .on('sponsorClick', () => { })
        .on('openSponsor', () => {
            vscode.commands.executeCommand(
                'workbench.extensions.action.showExtensionsWithIds',
                ['cweijan.vscode-database-client2'],
            );
        })
        .on('openExternal', (url: string) => {
            if (url) {
                void openLink(uri, url);
            }
        })
        .on('dispose', () => {
            delete fileSaveTimes[uri.toString()];
        })
}
