import axios from 'axios';
import * as vscode from 'vscode';
import { extensionResource, getExtensionUri, readExtensionText } from './extensionResource';

interface ViewOption {
    route: string;
    fileName?: string;
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class ReactApp {

    private static context: vscode.ExtensionContext;
    private static webviewUri: vscode.Uri;
    public static IS_DEV = false;

    public static init(context: vscode.ExtensionContext) {
        this.context = context;
        this.webviewUri = extensionResource(context, 'out', 'webview');
        this.IS_DEV = context.extensionMode == vscode.ExtensionMode.Development;
    }

    public static async view(webview: vscode.Webview, option: ViewOption) {
        const html = await this.readContent();
        const configs = JSON.stringify({
            ...option,
            language: vscode.env.language,
            config: vscode.workspace.getConfiguration('vscode-office')
        });
        // the configs go into a quoted attribute: escape them, and use a replacer function so `$` patterns are not expanded
        webview.html = this.buildPath(html, webview)
            .replace(`{{configs}}`, () => escapeHtmlAttribute(configs));
    }

    private static async readContent(): Promise<string> {
        if (this.IS_DEV) {
            const devServerUrl = 'http://127.0.0.1:5739';
            const data: string = (await axios.get(`${devServerUrl}/index.html`, { transformResponse: [] })).data;
            return data.replace(/(["'])\/(?=(?:@|src\/|index\.html\?))/g, `$1${devServerUrl}/`);
        }
        return readExtensionText(this.context, 'out', 'webview', 'index.html');
    }

    private static buildPath(data: string, webview: vscode.Webview): string {
        const baseUrl = ReactApp.getBaseUrl(webview);
        return data.replace('<base href="/">', () => `<base href="${escapeHtmlAttribute(baseUrl)}/">`);
    }

    private static getBaseUrl(webview: vscode.Webview) {
        if (this.IS_DEV) {
            return `http://127.0.0.1:5739`;
        }
        return webview.asWebviewUri(this.webviewUri).toString();
    }

    public static getExtensionUri(): vscode.Uri {
        return getExtensionUri(this.context);
    }

}