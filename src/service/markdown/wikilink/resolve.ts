import { sep } from 'path';
import * as vscode from 'vscode';
import { pickBestUri } from './fileMatch';
import { findMarkdownInScope, findMarkdownRecursive, statMarkdownAt } from './fileSearch';
import { normalizePage } from './parse';
import { buildSearchRootUris } from './searchRoots';

export async function resolveWikiLinkFile(
    currentUri: vscode.Uri,
    page: string,
): Promise<vscode.Uri | null> {
    const normalized = normalizePage(page);
    if (!normalized || normalized.startsWith('#')) {
        return currentUri;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(currentUri);
    const workspaceUri = workspaceFolder?.uri;
    const roots = buildSearchRootUris(currentUri, workspaceUri);

    // 1. Direct stat in ancestor directories (fastest, works on desktop / Web / Remote)
    for (const root of roots) {
        const found = await statMarkdownAt(root, normalized);
        if (found) {
            return found;
        }
    }

    if (!workspaceFolder || !workspaceUri) {
        return null;
    }

    const workspacePath = workspaceUri.fsPath;

    // 2. Exact findFiles match within each ancestor directory (handles edge cases such as stat permissions)
    for (const root of roots) {
        if (root.fsPath !== workspacePath && !root.fsPath.startsWith(workspacePath.endsWith(sep) ? workspacePath : workspacePath + sep)) {
            continue;
        }
        const scoped = await findMarkdownInScope(workspaceFolder, root.fsPath, normalized);
        const best = pickBestUri(scoped, normalized);
        if (best) {
            return best;
        }
    }

    // 3. Recursive ** match across the workspace (fallback when the vault root is not the workspace root)
    const recursiveHits = await findMarkdownRecursive(workspaceFolder, workspacePath, normalized);
    return pickBestUri(recursiveHits, normalized);
}
