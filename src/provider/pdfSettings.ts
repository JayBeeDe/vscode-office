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

export const PDF_TOOLS = ['hand', 'selection'] as const;
export type PdfTool = typeof PDF_TOOLS[number];

/** The `vscode-office.pdf.tool` setting: the cursor tool a PDF opens with, read when the viewer opens. */
export function getPdfTool(): PdfTool {
    const value = Global.getConfig<string>('pdf.tool', 'hand');
    return (PDF_TOOLS as readonly string[]).includes(value) ? value as PdfTool : 'hand';
}

export const PDF_SCROLLINGS = ['vertical', 'horizontal', 'wrapped'] as const;
export type PdfScrolling = typeof PDF_SCROLLINGS[number];

/** The `vscode-office.pdf.scrolling` setting: the scroll mode a PDF opens with, read when the viewer opens. */
export function getPdfScrolling(): PdfScrolling {
    const value = Global.getConfig<string>('pdf.scrolling', 'vertical');
    return (PDF_SCROLLINGS as readonly string[]).includes(value) ? value as PdfScrolling : 'vertical';
}

export const PDF_SPREADS = ['none', 'odd', 'even'] as const;
export type PdfSpread = typeof PDF_SPREADS[number];

/** The `vscode-office.pdf.spread` setting: the page spreads a PDF opens with, read when the viewer opens. */
export function getPdfSpread(): PdfSpread {
    const value = Global.getConfig<string>('pdf.spread', 'none');
    return (PDF_SPREADS as readonly string[]).includes(value) ? value as PdfSpread : 'none';
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
