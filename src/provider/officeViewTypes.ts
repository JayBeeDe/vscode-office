import { getFileSuffix } from '@/common/fileSuffix';

/**
 * The editors OfficeViewerProvider serves, one per component (package.json `customEditors`):
 * "Reopen Editor With..." lists them by name, "Editor" when the files can be edited, "Viewer"
 * otherwise.
 */
export const OFFICE_VIEW_TYPES = {
    spreadsheet: 'cweijan.spreadsheetEditor',
    document: 'cweijan.documentEditor',
    presentation: 'cweijan.presentationViewer',
    pdf: 'cweijan.pdfViewer',
    epub: 'cweijan.epubViewer',
    xmind: 'cweijan.xmindEditor',
    parquet: 'cweijan.parquetViewer',
} as const;

const COMPONENT_SUFFIXES: Record<keyof typeof OFFICE_VIEW_TYPES, string[]> = {
    spreadsheet: ['.xls', '.xlt', '.xlsx', '.xlsm', '.xltx', '.xltm', '.csv', '.tsv', '.ods', '.ots'],
    document: ['.docx', '.docm', '.dotx', '.dotm'],
    presentation: ['.pptx', '.pptm', '.ppsx', '.potx', '.ppsm', '.potm'],
    pdf: ['.pdf'],
    epub: ['.epub'],
    xmind: ['.xmind'],
    parquet: ['.parquet'],
};

/** The editor that opens this file, by its suffix; undefined when none of them does. */
export function officeViewType(fsPath: string): string | undefined {
    const suffix = getFileSuffix(fsPath);
    for (const [component, suffixes] of Object.entries(COMPONENT_SUFFIXES)) {
        if (suffixes.includes(suffix)) {
            return OFFICE_VIEW_TYPES[component as keyof typeof OFFICE_VIEW_TYPES];
        }
    }
    return undefined;
}
