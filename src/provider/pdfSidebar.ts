import { Global } from '@/common/global';
import { Handler } from '@/common/handler';
import * as vscode from 'vscode';

export const PDF_SIDEBARS = ['auto-outlines', 'always-outlines', 'always-thumbnails', 'none-outlines', 'none-thumbnails'] as const;
export type PdfSidebar = typeof PDF_SIDEBARS[number];

/** The `vscode-office.pdf.sidebar` setting: whether the sidebar opens with a PDF, and the view it shows. */
export function getPdfSidebar(): PdfSidebar {
    const value = Global.getConfig<string>('pdf.sidebar', 'auto-outlines');
    return (PDF_SIDEBARS as readonly string[]).includes(value) ? value as PdfSidebar : 'auto-outlines';
}

/** Sends `pdfSidebar` to the PDF viewer whenever the setting changes: it applies from the next opening. */
export function bindPdfSidebar(handler: Handler) {
    const subscription = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('vscode-office.pdf.sidebar')) {
            handler.emit('pdfSidebar', getPdfSidebar());
        }
    });
    handler.panel.onDidDispose(() => subscription.dispose());
}
