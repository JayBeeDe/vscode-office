import { FilePermission, Uri, workspace } from 'vscode';

/** true for git revisions, read-only file systems (such as a read-only vscode-vfs repo) and files marked read-only */
export async function isUriReadOnly(uri: Uri): Promise<boolean> {
    if (uri.scheme === 'git') {
        return true;
    }
    if (workspace.fs.isWritableFileSystem(uri.scheme) === false) {
        return true;
    }
    try {
        const stat = await workspace.fs.stat(uri);
        if (stat.permissions != null && (stat.permissions & FilePermission.Readonly)) {
            return true;
        }
    } catch {
        return false;
    }
    return false;
}
