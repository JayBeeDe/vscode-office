import type { CellStyle, SheetData } from './x-spreadsheet/index';

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Column letters of a 0-based index: 0 → A, 25 → Z, 26 → AA, 728 → ABA. */
function stringAt(index: number): string {
    let str = '';
    let n = index + 1;
    while (n > 0) {
        const rest = (n - 1) % COL_LETTERS.length;
        str = COL_LETTERS[rest] + str;
        n = Math.floor((n - 1) / COL_LETTERS.length);
    }
    return str;
}

/** x-spreadsheet default row height (px), matches row.height in Excel.tsx */
export const DEFAULT_ROW_HEIGHT_PX = 30;

/** Minimum number of viewport columns (A–X, 24 columns) */
export const MIN_VIEW_COLS = 24;

/** Minimum number of viewport rows */
export const MIN_VIEW_ROWS = 40;

/** Excel row height (points) → pixels */
export function excelRowHeightToPx(pt: number): number {
    return Math.round(pt * 96 / 72);
}

/** Pixels → Excel row height (points) */
export function pxToExcelRowHeight(px: number): number {
    return px * 72 / 96;
}

/** x-spreadsheet freeze string, e.g. "B2" */
export function freezeToExpr(rowIndex: number, colIndex: number): string {
    return `${stringAt(colIndex)}${rowIndex + 1}`;
}

/** Convert Excel views xSplit/ySplit to an x-spreadsheet freeze string */
export function excelFreezeToExpr(xSplit = 0, ySplit = 0): string | undefined {
    if (xSplit <= 0 && ySplit <= 0) return undefined;
    return freezeToExpr(ySplit, xSplit);
}

export interface SpreadsheetAutofilter {
    ref: string;
    filters?: { ci: number; operator: string; value: unknown }[];
    sort?: { ci: number; order: string };
}

export function readAutofilterRef(autoFilter: unknown): SpreadsheetAutofilter | undefined {
    if (!autoFilter) return undefined;
    if (typeof autoFilter === 'string') {
        return { ref: autoFilter, filters: [] };
    }
    if (typeof autoFilter === 'object' && autoFilter !== null) {
        const af = autoFilter as { from?: string | { row: number; column: number }; to?: string | { row: number; column: number } };
        const fromAddr = addressToString(af.from);
        const toAddr = addressToString(af.to);
        if (fromAddr && toAddr) {
            return { ref: `${fromAddr}:${toAddr}`, filters: [] };
        }
    }
    return undefined;
}

function addressToString(addr?: string | { row: number; column: number }): string | undefined {
    if (!addr) return undefined;
    if (typeof addr === 'string') return addr;
    return `${stringAt(addr.column - 1)}${addr.row}`;
}

interface FormattingSheetSnapshot {
    styles?: CellStyle[];
    merges?: string[];
    freeze?: string;
    autofilter?: SpreadsheetAutofilter;
    cellStyles: [number, number, number][];
    rowHeights: [number, number][];
}

function buildSheetFormattingSnapshot(sheet: SheetData): FormattingSheetSnapshot {
    const cellStyles: [number, number, number][] = [];
    const rowHeights: [number, number][] = [];
    const rows = sheet.rows;
    if (rows?.len) {
        for (let ri = 0; ri < rows.len; ri += 1) {
            const row = rows[ri];
            if (!row || typeof row !== 'object') continue;
            if ('height' in row && row.height != null && Math.abs(row.height - DEFAULT_ROW_HEIGHT_PX) >= 1) {
                rowHeights.push([ri, row.height]);
            }
            if (!('cells' in row) || !row.cells) continue;
            for (const ciKey of Object.keys(row.cells)) {
                const ci = Number(ciKey);
                const cell = row.cells[ci];
                if (cell?.style != null) {
                    cellStyles.push([ri, ci, cell.style]);
                }
            }
        }
    }
    cellStyles.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    rowHeights.sort((a, b) => a[0] - b[0]);

    const af = sheet.autofilter as SpreadsheetAutofilter | undefined;
    return {
        styles: sheet.styles,
        merges: sheet.merges?.length ? [...sheet.merges].sort() : undefined,
        freeze: sheet.freeze,
        autofilter: af?.ref ? af : undefined,
        cellStyles,
        rowHeights,
    };
}

/** Extract a snapshot of the toolbar-related formatting, used to detect style changes */
export function buildFormattingSnapshot(sheets: SheetData[]): string {
    return JSON.stringify(sheets.map(buildSheetFormattingSnapshot));
}

/** Whether the formatting changed relative to the initial snapshot */
export function hasFormattingChanged(initialSnapshot: string, sheets: SheetData[]): boolean {
    if (!initialSnapshot) return false;
    return buildFormattingSnapshot(sheets) !== initialSnapshot;
}

/** Parse Excel views parameters from an x-spreadsheet freeze string */
export function freezeExprToExcelView(freeze: string): { xSplit: number; ySplit: number } | undefined {
    let colPart = '';
    let rowPart = '';
    for (let i = 0; i < freeze.length; i += 1) {
        const ch = freeze.charAt(i);
        if (ch >= '0' && ch <= '9') rowPart += ch;
        else colPart += ch;
    }
    if (!colPart && !rowPart) return undefined;
    let colIndex = 0;
    for (let i = 0; i < colPart.length; i += 1) {
        colIndex = 26 * colIndex + colPart.charCodeAt(i) - 64;
    }
    colIndex -= 1;
    const rowIndex = rowPart ? parseInt(rowPart, 10) - 1 : 0;
    const xSplit = colIndex;
    const ySplit = rowIndex;
    if (xSplit <= 0 && ySplit <= 0) return undefined;
    return { xSplit, ySplit };
}
