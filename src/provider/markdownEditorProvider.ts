import { adjustImgPath, getWorkspacePath } from '@/common/fileUtil';
import { isAbsolute, parse, resolve } from 'path';
import * as vscode from 'vscode';
import { extensionResource, getExtensionResourceRoots, readExtensionText } from '@/common/extensionResource';
import { ensureParentDirectory } from '@/common/workspaceFs';
import { Handler } from '../common/handler';
import { Util } from '../common/util';
import { Holder } from '../service/markdown/holder';
import { MarkdownService } from '../service/markdownService';
import { Global, i18n } from '@/common/global';
import { bindTheme, getTheme } from '@/common/theme';
import { getMessages, resolveLanguage } from '@/i18n';
import { openWikiLink } from '@/service/markdown/wikilink';
import {
    broadcastToMarkdownWebviews,
    consumePendingBlockScroll,
    registerMarkdownWebview,
    unregisterMarkdownWebview,
} from '@/service/markdown/blockScroll';
import { parseWebviewResourceUri } from '@/common/webviewUri';

function getRuntimePlatform(): string {
    if (typeof process !== 'undefined' && process.platform) {
        return process.platform;
    }
    return 'web';
}

export interface MarkdownEditorProviderOptions {
    isWeb?: boolean;
}

const MARKDOWN_SYNC_CONFIG_KEYS = [
    'editMode',
    'theme',
    'codeMirrorTheme',
    'mermaidTheme',
] as const;

type MarkdownSyncConfigKey = typeof MARKDOWN_SYNC_CONFIG_KEYS[number];

/** The editor's display settings, sent together as `editorSettings` */
const EDITOR_SETTING_KEYS = [
    'uiFontSize',
    'editorFontSize',
    'editorFontFamily',
    'boldColor',
    'pageWidth',
    'editorLineHeight',
    'codeFontFamily',
    'codeBlockMaxHeight',
    'imageMaxWidth',
    'imageMaxHeight',
] as const;

function getEditorSettings(config: vscode.WorkspaceConfiguration) {
    return Object.fromEntries(EDITOR_SETTING_KEYS.map(key => [key, config.get(key)]));
}

/**
 * support view and edit office files.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {

    private static legacyGlobalStatePurged = false;

    private countStatus: vscode.StatusBarItem;
    /** the panel whose line and character count is shown */
    private countOwner: Handler | undefined;

    constructor(
        private context: vscode.ExtensionContext, private options: MarkdownEditorProviderOptions = {}
    ) {
        this.countStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.context.subscriptions.push(this.countStatus);
        this.purgeLegacyGlobalState();
        MarkdownEditorProvider.registerConfigSync(this.context);
    }

    static registerConfigSync(context: vscode.ExtensionContext): void {
        if (MarkdownEditorProvider.configSyncRegistered) {
            return;
        }
        MarkdownEditorProvider.configSyncRegistered = true;
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                const config = vscode.workspace.getConfiguration('vscode-office.markdown');
                const patch: Partial<Record<MarkdownSyncConfigKey | 'editorSettings', unknown>> = {};
                let changed = false;
                for (const key of MARKDOWN_SYNC_CONFIG_KEYS) {
                    if (event.affectsConfiguration(`vscode-office.markdown.${key}`)) {
                        patch[key] = config.get(key);
                        changed = true;
                    }
                }
                if (EDITOR_SETTING_KEYS.some(key => event.affectsConfiguration(`vscode-office.markdown.${key}`))) {
                    patch.editorSettings = getEditorSettings(config);
                    changed = true;
                }
                if (changed) {
                    broadcastToMarkdownWebviews('markdownConfig', patch);
                }
            }),
        );
    }

    private static configSyncRegistered = false;

    private purgeLegacyGlobalState() {
        if (MarkdownEditorProvider.legacyGlobalStatePurged) {
            return;
        }
        MarkdownEditorProvider.legacyGlobalStatePurged = true;
        const state = this.context.globalState;
        for (const key of state.keys()) {
            if (key.startsWith('scrollTop_')) {
                void state.update(key, undefined);
            }
        }
    }

    private getFolders(): vscode.Uri[] {
        if (vscode.env.uiKind === vscode.UIKind.Web) {
            return [];
        }
        const data = [];
        for (let i = 65; i <= 90; i++) {
            data.push(vscode.Uri.file(`${String.fromCharCode(i)}:/`))
        }
        return data;
    }

    private getWorkspaceUriByFileUtil(uri: vscode.Uri): vscode.Uri | undefined {
        const workspacePath = getWorkspacePath(uri);
        if (!workspacePath) {
            return undefined;
        }
        return vscode.Uri.file(workspacePath);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void | Thenable<void> {
        // console.log('schema', document.uri.scheme, document.uri.path, document.uri.query);
        const uri = document.uri;
        const webview = webviewPanel.webview;
        const folderPath = vscode.Uri.joinPath(uri, '..')
        webview.options = {
            enableScripts: true,
            localResourceRoots: [
                ...getExtensionResourceRoots(this.context),
                folderPath,
                ...(vscode.workspace.workspaceFolders?.map(folder => folder.uri) ?? []),
                vscode.Uri.file("/"),
                ...this.getFolders(),
            ],
        }
        const handler = Handler.bind(webviewPanel, uri);
        void this.handleMarkdown(document, handler, folderPath);
        handler.on('developerTool', () => vscode.commands.executeCommand('workbench.action.toggleDevTools'))
    }

    private async handleMarkdown(document: vscode.TextDocument, handler: Handler, folderPath: vscode.Uri) {

        const uri = document.uri;
        const webview = handler.panel.webview;

        let content = document.getText();
        const contextUri = extensionResource(this.context, 'resource', 'markdown');
        const rootPath = webview.asWebviewUri(contextUri).toString();

        Holder.activeDocument = document;
        handler.panel.onDidChangeViewState(e => {
            Holder.activeDocument = e.webviewPanel.visible ? document : Holder.activeDocument
            if (e.webviewPanel.active) {
                this.countOwner = handler;
                this.updateCount(content, handler)
                this.countStatus.show()
            } else if (this.countOwner === handler) {
                this.countOwner = undefined;
                this.countStatus.hide()
            }
        });

        let documentSyncTimer: ReturnType<typeof setTimeout> | undefined;
        let pendingDocumentSync: string | undefined;
        // texts we are writing to the document: their change events are our own echo, even when
        // newer keystrokes have arrived meanwhile
        const appliedTexts = new Set<string>();
        const flushDocumentSync = async () => {
            if (documentSyncTimer) {
                clearTimeout(documentSyncTimer);
                documentSyncTimer = undefined;
            }
            if (pendingDocumentSync === undefined) {
                return;
            }
            const nextContent = pendingDocumentSync;
            pendingDocumentSync = undefined;
            content = nextContent;
            appliedTexts.add(nextContent);
            try {
                await this.updateTextDocument(document, nextContent);
            } finally {
                setTimeout(() => appliedTexts.delete(nextContent), 0);
            }
        };
        const scheduleDocumentSync = (newContent: string) => {
            pendingDocumentSync = newContent;
            content = newContent;
            this.updateCount(content, handler);
            if (documentSyncTimer) {
                clearTimeout(documentSyncTimer);
            }
            // the first edit of a clean document is written at once: VS Code then knows it is
            // dirty and asks before closing, even right after typing
            if (!document.isDirty && !appliedTexts.size) {
                void flushDocumentSync();
                return;
            }
            // Debounce to avoid triggering VS Code built-in mermaid-markdown-features
            // re-parsing on every keystroke (ANTLR token recognition errors in console).
            documentSyncTimer = setTimeout(() => void flushDocumentSync(), 400);
        };
        const config = vscode.workspace.getConfiguration("vscode-office.markdown");
        registerMarkdownWebview(uri, handler);
        bindTheme(handler);
        handler.panel.onDidDispose(() => {
            void flushDocumentSync();
            unregisterMarkdownWebview(uri, handler);
            if (this.countOwner === handler) {
                this.countOwner = undefined;
                this.countStatus.hide();
            }
        });
        handler.on("init", async () => {
            const workspaceUri = this.getWorkspaceUriByFileUtil(uri);
            handler.emit("open", {
                content, rootPath,
                workspaceBaseUrl: workspaceUri ? webview.asWebviewUri(workspaceUri).toString().replace(/\?.+$/, '') : '',
                documentCacheId: `${uri.scheme}:${uri.toString()}`,
                pendingFragment: consumePendingBlockScroll(uri),
                shouldRestoreFocus: config.get<boolean>("restoreViewState", true),
                // a PDF or DOCX export started from another panel
                exporting: MarkdownService.exporting,
                config: this.getMarkdownWebviewConfig(config),
            })
            this.countOwner = handler;
            this.updateCount(content, handler)
            this.countStatus.show()
        }).on("externalUpdate", e => {
            // our own edits come back here with the same text; anything else (save participants
            // trimming whitespace, other editors) is applied to the webview
            const updatedText = e.document.getText()?.replace(/\r/g, '');
            if (content == updatedText || appliedTexts.has(updatedText)) return;
            content = updatedText;
            this.updateCount(content, handler)
            handler.emit("update", updatedText)
        }).on("command", (command) => {
            vscode.commands.executeCommand(command)
        }).on("searchTag", (tag: string) => {
            if (!tag) return;
            void vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: `#${tag}`,
                triggerSearch: true,
                filesToInclude: '*.md,*.markdown',
            });
        }).on("openLink", async (linkUri: string) => {
            if (linkUri.startsWith('wiki:')) {
                await openWikiLink(uri, linkUri);
                return;
            }
            const localUri = parseWebviewResourceUri(linkUri, uri, this.getWorkspaceUriByFileUtil(uri));
            if (localUri) {
                vscode.commands.executeCommand('vscode.open', localUri, { preview: false });
            } else {
                vscode.env.openExternal(vscode.Uri.parse(linkUri));
            }
        }).on("editorFontSize", (size: unknown) => {
            // ctrl/⌘+wheel in the editor
            if (typeof size === "number") {
                Global.updateConfig("markdown.editorFontSize", size);
            }
        }).on("editMode", (mode: string) => {
            if (mode === "wysiwyg" || mode === "ir") {
                Global.updateConfig("markdown.editMode", mode);
            }
        }).on("img", async (payload) => {
            const imgData: string = typeof payload === 'string' ? payload : payload.data;
            const ext: string = typeof payload === 'string' ? 'png' : (payload.ext || 'png');
            const imageMarkdown = await this.saveImageAndBuildMarkdown(uri, imgData, ext);
            if (imageMarkdown) {
                handler.emit('insertImageMarkdown', imageMarkdown);
            }
        }).on("editInVSCode", (full: boolean) => {
            const side = full ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
            vscode.commands.executeCommand('vscode.openWith', uri, "default", side);
        }).on("save", (newContent) => {
            // every edit counts, also those typed right after Ctrl+S
            if (newContent === content && pendingDocumentSync === undefined) return;
            scheduleDocumentSync(newContent);
        }).on("doSave", async (saveContent) => {
            pendingDocumentSync = saveContent;
            content = saveContent;
            await flushDocumentSync();
            this.updateCount(content, handler);
            vscode.commands.executeCommand('workbench.action.files.save');
        }).on("export", async (option) => {
            // the export reads the file: write the latest edits to it first
            await flushDocumentSync();
            await document.save();
            await new MarkdownService(this.context).exportMarkdown(uri, option)
        }).on('developerTool', () => {
            vscode.commands.executeCommand('workbench.action.toggleDevTools')
        }).on('openExternal', (url: string) => {
            if (url) {
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        })

        // without a workspace folder the document's folder stays the base, not the disk root
        const workspacePath = Global.getConfig('markdown.workspacePathAsImageBasePath') ? getWorkspacePath(folderPath) : '';
        const basePath = workspacePath ? vscode.Uri.file(workspacePath) : folderPath;
        const baseUrl = webview.asWebviewUri(basePath).toString().replace(/\?.+$/, '').replace('https://git', 'https://file');
        const indexHtml = await readExtensionText(this.context, 'resource', 'markdown', 'index.html');
        webview.html = Util.buildPath(
            indexHtml.replace("{{baseUrl}}", baseUrl), webview, contextUri
        );
    }

    private getMarkdownWebviewConfig(configuration: vscode.WorkspaceConfiguration) {
        const markdownConfiguration = vscode.workspace.getConfiguration("markdown");
        return {
            editMode: configuration.get<string>("editMode", "wysiwyg"),
            theme: getTheme(),
            pageTheme: configuration.get<string>("theme", "auto"),
            codeMirrorTheme: configuration.get<string>("codeMirrorTheme", "auto"),
            mermaidTheme: configuration.get<string>("mermaidTheme", "auto"),
            editorSettings: getEditorSettings(configuration),
            markdown: {
                math: {
                    macros: markdownConfiguration.get<Record<string, string>>("math.macros", {}),
                },
            },
            language: vscode.env.language,
            // the editor's strings in the VS Code language, English filling in the missing ones
            i18n: getMessages(resolveLanguage(vscode.env.language)).markdown,
            isWeb: this.options.isWeb,
            isDev: this.context.extensionMode === vscode.ExtensionMode.Development,
        };
    }

    private async saveImageAndBuildMarkdown(
        documentUri: vscode.Uri,
        imageData: string | Uint8Array,
        ext: string,
    ): Promise<string | undefined> {
        const { relPath, fullPath } = adjustImgPath(documentUri, ext);
        const imagePath = isAbsolute(fullPath) ? fullPath : `${resolve(documentUri.fsPath, "..")}/${relPath}`.replace(/\\/g, "/");
        // the image goes next to the document, on the document's own file system (vscode-vfs...)
        const imageUri = documentUri.scheme === 'file'
            ? vscode.Uri.file(imagePath)
            : (isAbsolute(fullPath)
                ? documentUri.with({ path: fullPath.replace(/\\/g, '/'), query: '', fragment: '' })
                : vscode.Uri.joinPath(documentUri, '..', relPath));
        await ensureParentDirectory(imageUri);
        const bytes = typeof imageData === 'string'
            ? Uint8Array.from(Buffer.from(imageData, 'binary'))
            : imageData;
        await vscode.workspace.fs.writeFile(imageUri, bytes);
        const fileName = parse(relPath).name;
        const adjustRelPath = imageUri.scheme === 'file' ? await MarkdownService.imgExtGuide(imagePath, relPath) : relPath;
        return `![${fileName}](${adjustRelPath})`;
    }

    private updateCount(content: string, handler: Handler) {
        // only the panel the count belongs to
        if (this.countOwner && this.countOwner !== handler) return;
        this.countStatus.text = i18n('markdown.statusBar', { lines: content.split(/\r\n|\r|\n/).length, chars: content.length })
    }

    private updateTextDocument(document: vscode.TextDocument, content: string) {
        const normalized = content.replace(/\r/g, '');
        if (document.getText().replace(/\r/g, '') === normalized) {
            return Promise.resolve(true);
        }
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), normalized);
        return vscode.workspace.applyEdit(edit);
    }

}
