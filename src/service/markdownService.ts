import { adjustImgPath } from "@/common/fileUtil";
import { Output } from "@/common/Output";
import { spawn } from 'child_process';
import chromeFinder from 'chrome-finder';
import { fileTypeFromFile } from 'file-type';
import { copyFileSync, existsSync, lstatSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import path, { dirname, extname, isAbsolute, join, parse } from 'path';
import * as vscode from 'vscode';
import { broadcastToMarkdownWebviews } from './markdown/blockScroll';
import { Holder } from './markdown/holder';
import { convertMd } from "./markdown/markdown-pdf";
import { Global, i18n } from "@/common/global";

export type ExportType = 'pdf' | 'html' | 'docx';

interface ExportOption {
    type?: ExportType;
    /** VS Code's accent (--vscode-focusBorder), as the editor shows it */
    accent?: string;
}

type Theme = 'light' | 'dark';

export class MarkdownService {

    /** a PDF or DOCX export is running: one at a time, their buttons are disabled meanwhile */
    public static exporting = false;

    constructor(private context: vscode.ExtensionContext) {
    }

    /**
     * export markdown to another type
     * @param type pdf, html, docx 
     */
    public async exportMarkdown(uri: vscode.Uri, option: ExportOption = {}) {
        const { type = 'pdf' } = option;
        if (type !== 'html' && MarkdownService.exporting) {
            return;
        }
        // PDF is made with Chromium, DOCX uses it for math and diagrams: without one, point to the setting
        const executablePath = type === 'html' ? undefined : this.getChromiumPath();
        if (type !== 'html' && !executablePath) {
            this.showNoChromium(type);
            if (type === 'pdf') {
                return;
            }
        }
        const convert = () => convertMd({ markdownFilePath: uri.fsPath, config: this.getConfig(option, executablePath) });
        if (type !== 'html') {
            MarkdownService.setExporting(true);
        }
        try {
            // HTML is written at once; PDF and DOCX show a spinner in the status bar meanwhile
            const exportPath: string = type === 'html' ? await convert() : await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: i18n('markdown.exporting', { type }) }, convert)
            this.showExportSuccess(type, exportPath);
        } catch (error) {
            Output.log(error)
            vscode.window.showErrorMessage(i18n('markdown.exportFailed', { type, error: error instanceof Error ? error.message : String(error) }))
        } finally {
            if (type !== 'html') {
                MarkdownService.setExporting(false);
            }
        }
    }

    private static setExporting(exporting: boolean) {
        MarkdownService.exporting = exporting;
        broadcastToMarkdownWebviews('exporting', exporting);
    }

    public getConfig(option: ExportOption, executablePath?: string) {
        const top = Global.getConfig("markdown.pdfMarginTop")
        const { type = 'pdf', accent } = option;
        return {
            type,
            // the page: light, or dark for an HTML export when vscode-office.markdown.exportHtml.theme says so
            pageTheme: type === 'html' ? this.resolveTheme('markdown.exportHtml.theme', 'markdown.theme', 'theme') : 'light',
            // code blocks and diagrams follow their settings, `auto` following the editor's page
            codeTheme: this.resolveTheme('markdown.codeMirrorTheme', 'markdown.theme', 'theme'),
            mermaidTheme: this.getMermaidTheme(),
            // a CSS colour only: it goes into the exported HTML
            accent: /^[#\w(),.%\s-]+$/.test(accent ?? '') ? accent : undefined,
            "styles": [],
            // chromium path, found by exportMarkdown for PDF and DOCX
            "executablePath": executablePath,
            // puppeteer launch args (useful for Linux servers running as root)
            "puppeteerArgs": this.getPuppeteerArgs(),
            // Set `true` to convert `\n` in paragraphs into `<br>`.
            "breaks": false,
            // pdf print option
            "printBackground": true,
            format: "A4",
            margin: { top }
        };
    }

    /**
     * The first of these settings set to `light` or `dark`, each one's `auto` following the next
     * (vscode-office.markdown.theme's follows vscode-office.theme's), then VS Code's own theme.
     */
    private resolveTheme(...keys: string[]): Theme {
        for (const key of keys) {
            const theme = Global.getConfig<string>(key, 'auto');
            if (theme === 'light' || theme === 'dark') {
                return theme;
            }
        }
        const kind = vscode.window.activeColorTheme.kind;
        return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? 'dark' : 'light';
    }

    /** vscode-office.markdown.mermaidTheme, `auto` following the editor's page like in the editor */
    private getMermaidTheme(): string {
        const theme = Global.getConfig<string>('markdown.mermaidTheme', 'auto');
        return theme && theme !== 'auto' ? theme : this.resolveTheme('markdown.theme', 'theme');
    }

    private getPuppeteerArgs(): string[] {
        // Custom args from settings
        const customArgs = Global.getConfig<string[]>("markdown.puppeteerArgs");
        if (customArgs && customArgs.length > 0) {
            return customArgs;
        }
        // On Linux, running as root requires --no-sandbox
        if (process.platform === 'linux') {
            try {
                const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
                if (uid === 0) {
                    return ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
                }
            } catch {
                // getuid not available on this platform
            }
        }
        return [];
    }

    private paths: string[] = [
        // Windows
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge Beta\\Application\\msedge.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge Dev\\Application\\msedge.exe",
        join(homedir(), "AppData\\Local\\Microsoft\\Edge SxS\\Application\\msedge.exe"),
        // macOS
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        // Linux
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
    ]

    private async showExportSuccess(type: ExportType, exportPath: string) {
        const openFile = i18n('markdown.openFile');
        const choice = await vscode.window.showInformationMessage(i18n('markdown.exportSuccess', { type, path: exportPath }), openFile);
        if (choice === openFile) {
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(exportPath));
        }
    }

    private async showNoChromium(type: ExportType) {
        const openSettings = i18n('markdown.openSettings');
        // a configured path that does not exist is named, an empty setting means none was found
        const configuredPath = Global.getConfig<string>("markdown.export.chromiumPath")?.trim();
        const choice = type === 'pdf'
            ? await vscode.window.showErrorMessage(configuredPath
                ? i18n('markdown.noChromiumAt', { type, path: configuredPath })
                : i18n('markdown.noChromium', { type }), openSettings)
            : await vscode.window.showWarningMessage(configuredPath
                ? i18n('markdown.noChromiumDocxAt', { path: configuredPath })
                : i18n('markdown.noChromiumDocx'), openSettings);
        if (choice === openSettings) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'vscode-office.markdown.export.chromiumPath');
        }
    }

    /**
     * vscode-office.markdown.export.chromiumPath when set, undefined if it does not exist: a wrong
     * path must be reported, not replaced; when empty, the usual install locations
     */
    private getChromiumPath(): string | undefined {
        const chromiumPath = Global.getConfig<string>("markdown.export.chromiumPath")?.trim()
        if (chromiumPath) {
            return existsSync(chromiumPath) ? chromiumPath : undefined;
        }
        for (const path of this.paths) {
            if (existsSync(path)) {
                console.debug(`using chromium path is ${path}`)
                return path;
            }
        }
        try {
            const chromePath = chromeFinder();
            console.debug(`using chrome path is ${chromePath}`)
            return chromePath;
        } catch {
            return undefined;
        }
    }

    public async loadClipboardImage() {

        const document = vscode.window.activeTextEditor?.document || Holder.activeDocument
        if (await vscode.env.clipboard.readText()) {
            vscode.commands.executeCommand("editor.action.clipboardPasteAction")
            return
        }

        if (!document || document.isUntitled || document.isClosed) {
            return
        }

        const markdown = await this.saveClipboardImage(document.uri);
        const editor = vscode.window.activeTextEditor;
        if (markdown && editor) {
            editor.edit(edit => {
                const current = editor.selection;
                if (current.isEmpty) {
                    edit.insert(current.start, markdown);
                } else {
                    edit.replace(current, markdown);
                }
            });
        }
    }

    /** Save the clipboard image next to the document; returns the markdown that shows it. */
    public saveClipboardImage(uri: vscode.Uri): Promise<string | undefined> {
        const info = adjustImgPath(uri, 'png'), { fullPath } = info;
        let { relPath } = info;
        const imagePath = isAbsolute(fullPath) ? fullPath : `${dirname(uri.fsPath)}/${relPath}`.replace(/\\/g, "/");
        this.createImgDir(imagePath);
        return new Promise((resolvePromise) => {
            this.saveClipboardImageToFileAndGetPath(imagePath, async (savedImagePath) => {
                if (!savedImagePath) return resolvePromise(undefined);
                if (savedImagePath === 'no image') {
                    vscode.window.showErrorMessage(i18n('markdown.noClipboardImage'));
                    return resolvePromise(undefined);
                }
                this.copyFromPath(savedImagePath, imagePath);
                const imgName = parse(relPath).name;
                relPath = await MarkdownService.imgExtGuide(imagePath, relPath);
                resolvePromise(`![${imgName}](${relPath})`);
            })
        });
    }

    /** Fix the extension of a saved image from its content; the link is kept when unsure. */
    public static async imgExtGuide(absPath: string, relPath: string) {
        const oldExt = extname(absPath)
        // file-type only knows binary formats: svg is text and keeps its name
        if (oldExt.toLowerCase() === '.svg') return relPath
        let ext: string | undefined
        try {
            ext = (await fileTypeFromFile(absPath))?.ext
        } catch {
            ext = undefined
        }
        if (!ext || oldExt === `.${ext}`) return relPath
        try {
            renameSync(absPath, absPath.replace(oldExt, `.${ext}`))
        } catch {
            // e.g. the web build, where renaming isn't available
            return relPath
        }
        return relPath.replace(oldExt, `.${ext}`)
    }

    /**
     * If the clipboard contains a copied file, get its path and copy it
     */
    private copyFromPath(savedImagePath: string, targetPath: string) {
        if (savedImagePath.startsWith("copied:")) {
            const copiedFile = savedImagePath.replace("copied:", "");
            if (lstatSync(copiedFile).isDirectory()) {
                vscode.window.showErrorMessage(i18n('markdown.noPasteDirectory'));
            } else {
                copyFileSync(copiedFile, targetPath);
            }
        }
    }

    private createImgDir(imagePath: string) {
        const dir = path.dirname(imagePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
    }

    private saveClipboardImageToFileAndGetPath(imagePath: string, cb: (value: string) => void) {
        if (!imagePath) return;
        const platform = process.platform;
        if (platform === 'win32') {
            // Windows
            const scriptPath = path.join(this.context.extensionPath, '/lib/pc.ps1');
            const powershell = spawn('powershell', [
                '-noprofile',
                '-noninteractive',
                '-nologo',
                '-sta',
                '-executionpolicy', 'unrestricted',
                '-windowstyle', 'hidden',
                '-file', scriptPath,
                imagePath
            ]);
            powershell.on('exit', function (code, signal) {
            });
            powershell.stdout.on('data', function (data) {
                cb(data.toString().trim());
            });
        } else if (platform === 'darwin') {
            // Mac
            const scriptPath = path.join(this.context.extensionPath, './lib/mac.applescript');
            const ascript = spawn('osascript', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
            });
            ascript.stdout.on('data', function (data) {
                cb(data.toString().trim());
            });
        } else {
            // Linux 
            const scriptPath = path.join(this.context.extensionPath, './lib/linux.sh');

            const ascript = spawn('sh', [scriptPath, imagePath]);
            ascript.on('exit', function (code, signal) {
            });
            ascript.stdout.on('data', function (data) {
                const result = data.toString().trim();
                if (result == "no xclip") {
                    vscode.window.showInformationMessage(i18n('markdown.installXclip'));
                    return;
                }
                cb(result);
            });
        }
    }

    public switchEditor(uri: vscode.Uri) {
        const editor = vscode.window.activeTextEditor;
        if (!uri) uri = editor?.document.uri;
        const type = editor ? 'cweijan.markdownViewer' : 'default';
        vscode.commands.executeCommand('vscode.openWith', uri, type);
    }

}
