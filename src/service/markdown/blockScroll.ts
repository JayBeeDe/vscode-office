import * as vscode from 'vscode';
import { Handler } from '@/common/handler';

const pendingBlockScroll = new Map<string, string>();
/** every open panel of each file: a file can be open in two split panels */
const webviewHandlers = new Map<string, Set<Handler>>();

/** Cache webviews by file path, ignoring query / fragment */
export function markdownUriKey(uri: vscode.Uri): string {
    return uri.with({ query: '', fragment: '' }).toString();
}

export function registerMarkdownWebview(uri: vscode.Uri, handler: Handler): void {
    const key = markdownUriKey(uri);
    const handlers = webviewHandlers.get(key) ?? new Set<Handler>();
    handlers.add(handler);
    webviewHandlers.set(key, handlers);
}

export function unregisterMarkdownWebview(uri: vscode.Uri, handler: Handler): void {
    const key = markdownUriKey(uri);
    const handlers = webviewHandlers.get(key);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) webviewHandlers.delete(key);
}

/** The most recently opened panel of the file. */
export function getMarkdownWebviewHandler(uri: vscode.Uri): Handler | undefined {
    const handlers = webviewHandlers.get(markdownUriKey(uri));
    return handlers ? Array.from(handlers).pop() : undefined;
}

export function setPendingBlockScroll(uri: vscode.Uri, fragment: string): void {
    pendingBlockScroll.set(markdownUriKey(uri), fragment);
}

export function consumePendingBlockScroll(uri: vscode.Uri): string | undefined {
    const key = markdownUriKey(uri);
    const fragment = pendingBlockScroll.get(key);
    if (fragment) {
        pendingBlockScroll.delete(key);
    }
    return fragment;
}

export function notifyBlockScroll(uri: vscode.Uri, fragment: string): void {
    const handler = getMarkdownWebviewHandler(uri);
    if (!handler) {
        setPendingBlockScroll(uri, fragment);
        return;
    }
    setTimeout(() => {
        handler.emit('gotoBlock', fragment);
    }, 150);
}

export function broadcastToMarkdownWebviews(event: string, content?: unknown): void {
    for (const handlers of webviewHandlers.values()) {
        for (const handler of handlers) {
            handler.emit(event, content);
        }
    }
}
