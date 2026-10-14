import { ReactApp } from '@/common/reactApp';
import { getFileSuffix } from '@/common/fileSuffix';
import * as vscode from 'vscode';
import { Handler } from '../common/handler';
import { handleCommonEvent } from './handlers/commonHandler';
import { extensionResource, getExtensionResourceRoots, readExtensionText } from '@/common/extensionResource';

/**
 * support view office files
 */
export class OfficeViewerProvider implements vscode.CustomReadonlyEditorProvider {

	constructor(private context: vscode.ExtensionContext) { }

	bindCustomEditors(viewOption: { webviewOptions: vscode.WebviewPanelOptions }) {
		return [
			vscode.window.registerCustomEditorProvider('cweijan.officeViewer', this, viewOption),
			vscode.window.registerCustomEditorProvider('cweijan.parquetViewer', this, viewOption),
		];
	}

	public openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken): vscode.CustomDocument | Thenable<vscode.CustomDocument> {
		return { uri, dispose: (): void => { } };
	}
	public resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void | Thenable<void> {
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
		handleCommonEvent(uri, handler);
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
				void this.loadPdfViewer(webview);
				break;
			case '.epub':
				route = 'epub';
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
		if (route) return ReactApp.view(webview, { route });
	}

	private async loadPdfViewer(webview: vscode.Webview) {
		const html = await readExtensionText(this.context, 'resource', 'pdf', 'viewer.html');
		webview.html = html.replace('{{baseUrl}}', this.getBaseUrl(webview, 'pdf'));
	}

	private getBaseUrl(webview: vscode.Webview, path: string) {
		const baseUrl = webview.asWebviewUri(extensionResource(this.context, 'resource', path))
			.toString().replace(/\?.+$/, '').replace('https://git', 'https://file');
		return baseUrl;
	}

}
