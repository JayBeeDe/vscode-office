import { relative } from 'path';
import * as vscode from 'vscode';
import { FIND_FILES_EXCLUDE, FIND_FILES_LIMIT } from './constants';
import { directFileNames, nameToGlob, recursiveFindPatterns } from './pagePattern';

/** The search globs ignore case and glob characters: keep the files whose path really matches. */
function matchesName(file: vscode.Uri, expected: string): boolean {
    const path = file.path.toLowerCase();
    const name = expected.replace(/\\/g, '/').toLowerCase();
    return path === name || path.endsWith(`/${name}`);
}

/** 直接路径探测：祖先目录 + 文件名，走 fs.stat，避免索引查询 */
export async function statMarkdownAt(baseDir: vscode.Uri, page: string): Promise<vscode.Uri | null> {
    for (const fileName of directFileNames(page)) {
        const fileUri = vscode.Uri.joinPath(baseDir, fileName);
        try {
            const stat = await vscode.workspace.fs.stat(fileUri);
            if (stat.type === vscode.FileType.File) {
                return fileUri;
            }
        } catch {
        }
    }
    return null;
}

function toRelativePattern(
    workspaceFolder: vscode.WorkspaceFolder,
    scopeDir: string,
    pattern: string,
): vscode.RelativePattern {
    const workspacePath = workspaceFolder.uri.fsPath;
    const relScope = relative(workspacePath, scopeDir).replace(/\\/g, '/');
    const fullPattern = relScope && relScope !== '.'
        ? `${relScope}/${pattern}`
        : pattern;
    return new vscode.RelativePattern(workspaceFolder, fullPattern);
}

/** 在 scopeDir 下用 findFiles 做精确相对匹配（非 **） */
export async function findMarkdownInScope(
    workspaceFolder: vscode.WorkspaceFolder,
    scopeDir: string,
    page: string,
): Promise<vscode.Uri[]> {
    const results: vscode.Uri[] = [];
    for (const fileName of directFileNames(page)) {
        const pattern = toRelativePattern(workspaceFolder, scopeDir, nameToGlob(fileName));
        const files = await vscode.workspace.findFiles(pattern, FIND_FILES_EXCLUDE, FIND_FILES_LIMIT);
        for (const file of files) {
            if (matchesName(file, fileName)) results.push(file);
        }
    }
    return results;
}

/** 在工作区（或子目录）内递归查找，模式形如 **/
export async function findMarkdownRecursive(
    workspaceFolder: vscode.WorkspaceFolder,
    scopeDir: string,
    page: string,
): Promise<vscode.Uri[]> {
    const workspacePath = workspaceFolder.uri.fsPath;
    const relScope = relative(workspacePath, scopeDir).replace(/\\/g, '/');
    const prefix = relScope && relScope !== '.' ? `${relScope}/` : '';
    const results: vscode.Uri[] = [];
    const seen = new Set<string>();

    for (const recursivePattern of recursiveFindPatterns(page)) {
        const name = recursivePattern.replace(/^\*\*\//, '');
        const pattern = new vscode.RelativePattern(
            workspaceFolder,
            `${prefix}**/${nameToGlob(name)}`,
        );
        const files = await vscode.workspace.findFiles(pattern, FIND_FILES_EXCLUDE, FIND_FILES_LIMIT);
        for (const file of files) {
            const key = file.fsPath;
            if (matchesName(file, name) && !seen.has(key)) {
                seen.add(key);
                results.push(file);
            }
        }
    }

    return results;
}
