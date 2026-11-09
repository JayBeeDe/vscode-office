import * as vscode from 'vscode';
import { OFFICE_VIEW_TYPES } from '@/provider/officeViewTypes';

export function switchCsvEditor(uri?: vscode.Uri) {
    const editor = vscode.window.activeTextEditor;
    const targetUri = uri ?? editor?.document.uri;
    if (!targetUri) return;
    const viewType = editor ? OFFICE_VIEW_TYPES.spreadsheet : 'default';
    void vscode.commands.executeCommand('vscode.openWith', targetUri, viewType);
}
