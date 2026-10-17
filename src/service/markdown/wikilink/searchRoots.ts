import * as vscode from 'vscode';

/** From the current note directory up to the workspace root, as candidates for the Obsidian vault root */
export function buildSearchRootUris(currentUri: vscode.Uri, workspaceUri?: vscode.Uri): vscode.Uri[] {
    const roots: vscode.Uri[] = [];
    let dir = vscode.Uri.joinPath(currentUri.with({ query: '', fragment: '' }), '..');
    const workspacePath = workspaceUri?.fsPath;

    while (true) {
        roots.push(dir);
        if (workspacePath && dir.fsPath === workspacePath) {
            break;
        }
        const parent = vscode.Uri.joinPath(dir, '..');
        if (parent.fsPath === dir.fsPath) {
            break;
        }
        dir = parent;
    }
    return roots;
}
