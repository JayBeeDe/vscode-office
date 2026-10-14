import * as vscode from 'vscode';
import { basename, join, parse } from 'path';
import { Handler } from "@/common/handler";
import { isUriReadOnly } from '@/common/fileReadOnly';
import { Uri, workspace } from 'vscode';
import { emitFileOfficeOpen, emitVirtualOfficeOpen, isVirtualUri } from '@/provider/handlers/officeContent';

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

export function shouldSkipFileChange(uri: Uri): boolean {
    const lastSaveTime = fileSaveTimes[uri.toString()];
    return !!(lastSaveTime && Date.now() - lastSaveTime < INTERNAL_SAVE_CHANGE_WINDOW_MS);
}

function setDirty(handler: Handler, uri: Uri, dirty: boolean) {
    const panel = handler.panel;
    const fileName = basename(uri.fsPath);
    panel.title = dirty ? `${fileName}*` : fileName;
    if (dirty) {
        void vscode.commands.executeCommand('workbench.action.keepEditor');
    }
}

export function handleCommonEvent(uri: Uri, handler: Handler) {
    let readOnly = false;
    const send = async () => {
        if (shouldSkipFileChange(uri)) {
            return;
        }
        readOnly = await isUriReadOnly(uri);
        // the panel may have been closed while awaiting
        if (handler.disposed) {
            return;
        }
        if (isVirtualUri(uri)) {
            void emitVirtualOfficeOpen(handler, uri);
            return;
        }
        await emitFileOfficeOpen(handler, uri, handler.panel.webview);
    }
    handler
        .on("editInVSCode", (full: boolean) => {
            const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
            vscode.commands.executeCommand('vscode.openWith', uri, "default", side);
        })
        .on("init", () => { void send(); })
        .on("fileChange", () => { void send(); })
        .on("change", () => {
            setDirty(handler, uri, true);
        })
        .on("save", async (content) => {
            const res = Array.isArray(content) ? new Uint8Array(content) : new TextEncoder().encode(content)
            if (readOnly) {
                handler.emit('saveAs', { content: [...res] });
                return;
            }
            fileSaveTimes[uri.toString()] = Date.now();
            await workspace.fs.writeFile(uri, res)
            fileSaveTimes[uri.toString()] = Date.now();
            setDirty(handler, uri, false);
            handler.emit("saveDone")
        })
        .on("saveAs", async (payload: { content: number[], ext?: string }) => {
            const res = new Uint8Array(payload.content);
            const ext = (payload.ext ?? 'xlsx').toLowerCase();
            const { dir, name } = parse(uri.fsPath);
            const defaultFileName = `${name}.${ext}`;
            const defaultUri = uri.scheme === 'file'
                ? Uri.file(join(dir, defaultFileName))
                : Uri.joinPath(uri, '..', defaultFileName);
            const filterMap: Record<string, { label: string; exts: string[] }> = {
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
            const info = filterMap[ext] ?? { label: ext.toUpperCase(), exts: [ext] };
            const target = await vscode.window.showSaveDialog({
                defaultUri,
                filters: { [info.label]: info.exts },
            });
            if (!target) return;
            fileSaveTimes[target.toString()] = Date.now();
            await workspace.fs.writeFile(target, res);
            fileSaveTimes[target.toString()] = Date.now();
            setDirty(handler, uri, false);
            handler.emit("saveDone");
            await vscode.commands.executeCommand('vscode.openWith', target, 'cweijan.officeViewer');
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
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        })
        .on('dispose', () => {
            delete fileSaveTimes[uri.toString()];
        })
}
