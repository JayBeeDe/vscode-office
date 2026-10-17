import { basename, extname } from 'path';
import * as vscode from 'vscode';
import { MARKDOWN_EXTENSIONS } from './constants';
import { normalizePage } from './parse';

export function matchesWikiPage(fullPath: string, page: string): boolean {
    const posix = fullPath.replace(/\\/g, '/').toLowerCase();
    const target = normalizePage(page).toLowerCase();

    if (target.includes('/')) {
        for (const ext of MARKDOWN_EXTENSIONS) {
            if (posix.endsWith(`/${target}${ext}`)) {
                return true;
            }
        }
        return posix.endsWith(`/${target}`);
    }

    // a note without its extension, or an attachment by its full name (img.png)
    const fileBase = basename(posix, extname(posix));
    return fileBase === target || basename(posix) === target;
}

/** With several matches, pick the shortest path (closest to the vault root) */
export function pickBestPath(paths: string[], page: string): string | null {
    let best: string | null = null;
    let bestLength = Number.MAX_SAFE_INTEGER;

    for (const fullPath of paths) {
        if (!matchesWikiPage(fullPath, page)) {
            continue;
        }
        if (fullPath.length < bestLength) {
            best = fullPath;
            bestLength = fullPath.length;
        }
    }

    return best;
}

/** With several matches, pick the shortest path (closest to the vault root), keeping the original URI scheme (Remote SSH, etc.) */
export function pickBestUri(uris: vscode.Uri[], page: string): vscode.Uri | null {
    let best: vscode.Uri | null = null;
    let bestLength = Number.MAX_SAFE_INTEGER;

    for (const uri of uris) {
        const fullPath = uri.fsPath;
        if (!matchesWikiPage(fullPath, page)) {
            continue;
        }
        if (fullPath.length < bestLength) {
            best = uri;
            bestLength = fullPath.length;
        }
    }

    return best;
}
