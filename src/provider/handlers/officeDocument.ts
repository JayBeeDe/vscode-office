import * as vscode from 'vscode';
import { Uri, workspace } from 'vscode';
import { Handler } from '@/common/handler';

interface ContentWaiter {
    resolve(content: Uint8Array): void;
    reject(error: Error): void;
}

/**
 * An office file opened in a viewer. The webview holds the edited content; VS Code drives
 * save, revert and backup through the provider, which asks the webview for the bytes.
 */
export class OfficeDocument implements vscode.CustomDocument {
    handler?: Handler;
    readOnly = false;
    dirty = false;
    /** content the webview saved on its own, waiting for VS Code to run the save */
    pendingContent?: Uint8Array;
    /** send the file to the webview again; `force` reloads even with unsaved edits */
    reload?: (force?: boolean) => Promise<void>;

    private waiter?: ContentWaiter;
    private queue: Promise<unknown> = Promise.resolve();
    private readonly disposeEmitter = new vscode.EventEmitter<void>();
    readonly onDidDispose = this.disposeEmitter.event;

    constructor(
        public readonly uri: Uri,
        /** backup to restore the content from, when VS Code reopens a document after hot exit */
        public readonly backupUri: Uri | undefined,
        private readonly onChange: (document: OfficeDocument) => void,
    ) { }

    markDirty() {
        this.dirty = true;
        this.onChange(this);
    }

    /** Ask the webview for the document bytes; `backup` skips any dialog or format prompt. */
    requestContent(backup: boolean): Promise<Uint8Array> {
        const run = () => new Promise<Uint8Array>((resolve, reject) => {
            const handler = this.handler;
            if (!handler || handler.disposed) {
                reject(new vscode.CancellationError());
                return;
            }
            this.waiter = {
                resolve: (content) => { this.waiter = undefined; resolve(content); },
                reject: (error) => { this.waiter = undefined; reject(error); },
            };
            handler.emit('saveRequest', { backup });
        });
        const result = this.queue.then(run, run);
        this.queue = result.catch(() => undefined);
        return result;
    }

    /** Hand content to a pending request; returns false when nothing was waiting for it. */
    resolveRequest(content: Uint8Array): boolean {
        if (!this.waiter) {
            return false;
        }
        this.waiter.resolve(content);
        return true;
    }

    cancelRequest() {
        this.waiter?.reject(new vscode.CancellationError());
    }

    async writeBackup(destination: Uri) {
        const content = await this.requestContent(true);
        await workspace.fs.writeFile(destination, content);
    }

    dispose() {
        this.cancelRequest();
        this.disposeEmitter.fire();
        this.disposeEmitter.dispose();
    }
}
