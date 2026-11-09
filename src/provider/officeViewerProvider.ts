import { ReactApp } from '@/common/reactApp';
import { getFileSuffix } from '@/common/fileSuffix';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { handleCommonEvent, revertOfficeDocument, saveOfficeDocument, saveOfficeDocumentAs } from './handlers/commonHandler';
import { OfficeDocument } from './handlers/officeDocument';
import { OFFICE_VIEW_TYPES } from './officeViewTypes';
import { extensionResource, getExtensionResourceRoots, readExtensionText } from '@/common/extensionResource';
import { resolveLanguage } from '@/i18n';
import { getPdfViewerStrings } from './pdfViewerStrings';
import { bindEpubSettings } from './epubSettings';
import { bindPdfSidebar, getPdfScrolling, getPdfSidebar, getPdfSpread, getPdfTool, getPdfZoom } from './pdfSettings';
import { bindDocumentTheme, bindEpubTheme, bindPdfTheme, bindTheme, getPdfTheme, getTheme } from '@/common/theme';
import { trackDocumentLoading, withLoadingOverlay } from '@/common/loadingStatus';

/**
 * support view office files
 */
export class OfficeViewerProvider implements vscode.CustomEditorProvider<OfficeDocument> {

	private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<OfficeDocument>>();
	public readonly onDidChangeCustomDocument = this.changeEmitter.event;

	constructor(private context: vscode.ExtensionContext) { }

	bindCustomEditors(viewOption: { webviewOptions: vscode.WebviewPanelOptions }) {
		return Object.values(OFFICE_VIEW_TYPES).map(viewType =>
			vscode.window.registerCustomEditorProvider(viewType, this, viewOption));
	}

	public openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): OfficeDocument {
		const backupUri = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : undefined;
		return new OfficeDocument(uri, backupUri, (document) => this.changeEmitter.fire({ document }));
	}

	public saveCustomDocument(document: OfficeDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return saveOfficeDocument(document);
	}

	public saveCustomDocumentAs(document: OfficeDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return saveOfficeDocumentAs(document, destination);
	}

	public revertCustomDocument(document: OfficeDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return revertOfficeDocument(document);
	}

	public async backupCustomDocument(document: OfficeDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
		await document.writeBackup(context.destination);
		return {
			id: context.destination.toString(),
			delete: () => {
				vscode.workspace.fs.delete(context.destination).then(undefined, () => undefined);
			},
		};
	}

	public resolveCustomEditor(document: OfficeDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void | Thenable<void> {
		const uri = document.uri;
		const webview = webviewPanel.webview;
		const folderPath = vscode.Uri.joinPath(uri, '..');
		webview.options = {
			enableScripts: true,
			localResourceRoots: [...getExtensionResourceRoots(this.context), folderPath],
		};

		const handler = Handler.bind(webviewPanel, uri);

		let route: string;
		const suffix = getFileSuffix(uri.fsPath);
		handleCommonEvent(document, handler);
		bindTheme(handler);
		switch (suffix) {
			case '.xlsx':
			case '.xlsm':
			case '.xltx':
			case '.xltm':
			case '.xls':
			case '.xlt':
			case '.csv':
			case '.tsv':
			case '.ods':
			case '.ots':
				route = 'excel';
				break;
			case '.docx':
			case '.docm':
			case '.dotm':
			case '.dotx':
				route = 'word';
				bindDocumentTheme(handler);
				break;
			case '.pptx':
			case '.pptm':
			case '.ppsx':
			case '.potx':
			case '.ppsm':
			case '.potm':
				route = 'ppt';
				break;
			case '.pdf':
				bindPdfTheme(handler);
				bindPdfSidebar(handler);
				trackDocumentLoading(handler, uri);
				void this.loadPdfViewer(webview, uri);
				break;
			case '.epub':
				route = 'epub';
				bindEpubTheme(handler);
				bindEpubSettings(handler);
				break;
			case '.xmind':
				route = 'xmind';
				break;
			case '.parquet':
				route = 'parquet';
				break;
			default:
				if (route) break;
				vscode.commands.executeCommand('vscode.openWith', uri, 'default');
		}
		if (!route) return;
		trackDocumentLoading(handler, uri);
		return ReactApp.view(webview, uri, { route });
	}

	private async loadPdfViewer(webview: vscode.Webview, uri: vscode.Uri) {
		const html = withLoadingOverlay(await readExtensionText(this.context, 'resource', 'pdf', 'viewer.html'), uri);
		const strings = getPdfViewerStrings(resolveLanguage(vscode.env.language));
		webview.html = html.replace('{{baseUrl}}', this.getBaseUrl(webview, 'pdf'))
			.replace('{{i18n}}', () => strings.buttons)
			.replace('{{l10n}}', () => strings.l10n)
			.replace('{{theme}}', () => JSON.stringify(getTheme()))
			.replace('{{pdfTheme}}', () => JSON.stringify(getPdfTheme()))
			.replace('{{pdfSidebar}}', () => JSON.stringify(getPdfSidebar()))
			.replace('{{pdfTool}}', () => JSON.stringify(getPdfTool()))
			.replace('{{pdfScrolling}}', () => JSON.stringify(getPdfScrolling()))
			.replace('{{pdfSpread}}', () => JSON.stringify(getPdfSpread()))
			.replace('{{pdfZoom}}', () => JSON.stringify(getPdfZoom()));
	}

	private getBaseUrl(webview: vscode.Webview, path: string) {
		const baseUrl = webview.asWebviewUri(extensionResource(this.context, 'resource', path))
			.toString().replace(/\?.+$/, '').replace('https://git', 'https://file');
		return baseUrl;
	}

}
