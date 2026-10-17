import { dirname, isAbsolute, parse } from 'path';
import * as vscode from 'vscode';
import { ensureParentDirectory } from './workspaceFs';
import { Global } from './global';

export async function writeFile(path: string, buffer: Uint8Array) {
    const uri = vscode.Uri.file(path);
    await ensureParentDirectory(uri);
    await vscode.workspace.fs.writeFile(uri, buffer);
}

export function adjustImgPath(uri: vscode.Uri, ext: string = 'png') {
    const now = new Date();
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const uuid = crypto.randomUUID().replace(/-/g, '');
    const workspaceFolderPath = getWorkspacePath(uri);
    // without a workspace folder, ${workspaceDir} stands for the document's folder
    const workspacePath = workspaceFolderPath || dirname(uri.fsPath);
    const replaceVariable = (text: string, name: string, value: string) => text.split(`\${${name}}`).join(value);
    let imgPath = Global.getConfig<string>("pasterImgPath");
    imgPath = replaceVariable(imgPath, 'fileName', parse(uri.fsPath).name.replace(/\s/g, ''));
    imgPath = replaceVariable(imgPath, 'now', now.getTime() + "");
    imgPath = replaceVariable(imgPath, 'date', date);
    imgPath = replaceVariable(imgPath, 'uuid', uuid);
    imgPath = replaceVariable(imgPath, 'ext', ext);
    const fullPath = replaceVariable(imgPath, 'workspaceDir', workspacePath);
    let relPath = imgPath.replace(/\$\{workspaceDir\}\/?/g, '');
    if (
        Global.getConfig<boolean>("pasteImageToWorkspacePath", false)
        && workspaceFolderPath
        && !isAbsolute(imgPath)
    ) {
        relPath = relPath.replace(/^[/\\]+/, '');
        return {
            relPath: `/${relPath}`,
            fullPath: `${workspacePath}/${relPath}`.replace(/\\/g, "/"),
        };
    }
    return {
        relPath,
        fullPath,
    };
}

/**
 * Get the workspace path of a uri
 * @param uri 
 * @returns 
 */
export function getWorkspacePath(uri: vscode.Uri): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length == 0) return '';
    return vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? folders[0].uri.fsPath;
}

export class FileUtil {
    private static context: vscode.ExtensionContext;
    public static init(context: vscode.ExtensionContext) {
        this.context = context;
    }
    public static async getLastPath(key: string | string[], path = '') {
        // Get the previously saved path
        let basePath: string;
        if (!Array.isArray(key)) { key = [key] }
        for (const itemKey of key) {
            basePath = this.context.globalState.get(itemKey + 'SelectorPath');
            if (basePath) break;
        }
        if (basePath) {
            const baseUri = vscode.Uri.file(basePath);
            try {
                await vscode.workspace.fs.stat(baseUri);
            } catch {
                basePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            }
        } else {
            basePath = '';
        }
        return vscode.Uri.file(basePath + path);
    }
}
