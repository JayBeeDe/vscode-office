import ExcelJS from '@cweijan/exceljs';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { inferSchema, initParser } from 'udsv';
import { decodeCsvBuffer } from './csvEncoding';
import { DEFAULT_ROW_HEIGHT_PX, excelFreezeToExpr, excelRowHeightToPx, readAutofilterRef } from './excel_meta';
import { readWorksheetSortStateXml } from './excel_sort_state';
import { excelJsCellToStyle, numFmtToSpreadsheetFormat, StyleRegistry } from './excel_styles';
import { mergeHyperlinkMaps, readCellHyperlink } from './excel_hyperlink';
import { readWorksheetBackgroundImage, readWorksheetImages } from './excel_images';
import { readWorksheetValidations } from './excel_validation';
import {
    isWorksheetProtected,
    readCellEditableFromExcel,
    readWorksheetProtection,
} from './excel_protection';
import type { CellData, SheetData } from './x-spreadsheet/index';
import { readSheetCodeNames } from './spreadsheet_vba';
import { formatExcelDate, isDateFormat, serialToDate } from './excel_dates';

type RowMap = NonNullable<SheetData['rows']>;

type ExcelJsWorksheetWithMerges = ExcelJS.Worksheet & {
    _merges?: Record<string, string | { range?: string }>;
    model: ExcelJS.Worksheet['model'] & {
        mergeCells?: string[];
        merges?: string[];
    };
};

export interface ExcelData {
    sheets: SheetData[];
    maxCols: number;
    maxLength?: number;
    /** Detected column delimiter when loading CSV/TSV */
    csvDelimiter?: string;
}

const MIN_COL_WIDTH = 70;
const MAX_COL_WIDTH = 300;
const DEFAULT_COL_WIDTH = 100;
const CHAR_WIDTH = 8;
const MAX_ROWS_TO_CHECK = 10;

const clampColWidth = (width: number) => Math.min(Math.max(width, MIN_COL_WIDTH), MAX_COL_WIDTH);

const calculateColWidth = (rows: any[], colIndex: number): number => {
    let maxLength = 0;
    for (let i = 0; i < Math.min(rows.length, MAX_ROWS_TO_CHECK); i += 1) {
        const cell = rows[i][colIndex];
        if (cell) {
            const length = String(cell).length;
            if (length > maxLength) {
                maxLength = length;
            }
        }
    }
    return clampColWidth(maxLength * CHAR_WIDTH);
};

const excelColWidthToPx = (width?: number) => {
    if (width == null) return null;
    return Math.round(width * 7 + 5);
};

const normalizeMergeRange = (merge: unknown): string | null => {
    if (typeof merge === 'string') return merge;
    if (merge && typeof merge === 'object' && 'range' in merge) {
        const range = (merge as { range?: unknown }).range;
        return typeof range === 'string' ? range : null;
    }
    return null;
};

const readWorksheetMerges = (worksheet: ExcelJS.Worksheet): string[] => {
    const ws = worksheet as ExcelJsWorksheetWithMerges;
    const mergeCandidates = [
        ...(ws.model?.merges ?? []),
        ...(ws.model?.mergeCells ?? []),
        ...Object.values(ws._merges ?? {}),
    ];
    const merges = mergeCandidates
        .map(normalizeMergeRange)
        .filter((it): it is string => Boolean(it));
    return Array.from(new Set(merges));
};

const expandSizeForMerge = (merge: string, size: { maxRow: number; maxCols: number }) => {
    const range = XLSX.utils.decode_range(merge);
    size.maxRow = Math.max(size.maxRow, range.e.r + 1);
    size.maxCols = Math.max(size.maxCols, range.e.c + 1);
};

const readSheetJsMerges = (worksheet: XLSX.WorkSheet) => (worksheet['!merges'] ?? [])
    .map(merge => XLSX.utils.encode_range(merge));

const expandSizeForSheetJsMerge = (merge: XLSX.Range, size: { maxRow: number; maxCols: number }) => {
    size.maxRow = Math.max(size.maxRow, merge.e.r + 1);
    size.maxCols = Math.max(size.maxCols, merge.e.c + 1);
};

const buildCsvCols = (rows: any[][], colCount: number) => {
    const cols: Record<number, { width: number }> = {};
    for (let i = 0; i < colCount; i += 1) {
        cols[i] = { width: calculateColWidth(rows, i) };
    }
    return cols;
};

const buildColsFromWorksheet = (worksheet: ExcelJS.Worksheet, colCount: number) => {
    const cols: Record<number, { width: number }> = {};
    for (let i = 1; i <= colCount; i += 1) {
        const width = excelColWidthToPx(worksheet.getColumn(i).width) ?? DEFAULT_COL_WIDTH;
        cols[i - 1] = { width: clampColWidth(width) };
    }
    return cols;
};

/** Text shown and edited for a cell; the writer compares it to keep values that weren't edited. */
export const formatCellText = (cell: ExcelJS.Cell, format?: string) => {
    const raw = cell.value;
    if (raw && typeof raw === 'object' && 'hyperlink' in raw) {
        const hv = raw as ExcelJS.CellHyperlinkValue;
        return hv.text || hv.hyperlink || '';
    }
    if (cell.formula) return `=${cell.formula}`;
    const value = cell.value;
    if (value && typeof value === 'object' && 'formula' in value) {
        const formula = (value as { formula?: string }).formula;
        if (formula) return `=${formula}`;
    }
    if (cell.value == null) return '';
    // checked before cell.text, which is Date.toString() for dates
    if (cell.value instanceof Date) {
        return formatExcelDate(cell.value, format);
    }
    if (typeof cell.value === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
    if (typeof cell.value === 'object' && 'error' in cell.value) {
        return String((cell.value as ExcelJS.CellErrorValue).error ?? '');
    }
    if (cell.text) return cell.text;
    return String(cell.value);
};

const readFreezeFromWorksheet = (worksheet: ExcelJS.Worksheet): string | undefined => {
    const views = worksheet.views;
    if (!views?.length) return undefined;
    for (let i = 0; i < views.length; i += 1) {
        const view = views[i];
        if (view.state === 'frozen') {
            const xSplit = view.xSplit ?? 0;
            const ySplit = view.ySplit ?? 0;
            return excelFreezeToExpr(xSplit, ySplit);
        }
    }
    return undefined;
};

type ExcelJsSheetExtras = Pick<SheetData, 'freeze' | 'autofilter'>;

const readSheetExtras = (worksheet: ExcelJS.Worksheet): ExcelJsSheetExtras => {
    const extras: ExcelJsSheetExtras = {};
    const freeze = readFreezeFromWorksheet(worksheet);
    if (freeze) extras.freeze = freeze;
    const autofilter = readAutofilterRef(worksheet.autoFilter);
    if (autofilter) extras.autofilter = autofilter;
    return extras;
};

const applyRowHeight = (rows: RowMap, ri: number, excelRow: ExcelJS.Row) => {
    if (excelRow.height == null) return;
    const px = excelRowHeightToPx(excelRow.height);
    if (Math.abs(px - DEFAULT_ROW_HEIGHT_PX) < 1) return;
    const existing = rows[ri];
    if (existing && typeof existing === 'object' && 'cells' in existing) {
        existing.height = px;
    } else {
        rows[ri] = { cells: {}, height: px };
    }
};

const readWorkbookSortStateXml = async (buffer: ArrayBuffer) => {
    const zip = await JSZip.loadAsync(buffer);
    const entries = new Map<number, ReturnType<typeof readWorksheetSortStateXml>>();
    const worksheetFiles = Object.keys(zip.files)
        .map((name) => {
            const match = /^xl\/worksheets\/sheet(\d+)\.xml$/i.exec(name);
            return match ? { index: Number(match[1]) - 1, name } : null;
        })
        .filter((it): it is { index: number; name: string } => Boolean(it))
        .sort((a, b) => a.index - b.index);

    for (let i = 0; i < worksheetFiles.length; i += 1) {
        const file = worksheetFiles[i];
        const xml = await zip.file(file.name)?.async('string');
        if (!xml) continue;
        entries.set(file.index, readWorksheetSortStateXml(xml));
    }

    return entries;
};

const convertExcelJsWorksheet = (worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook): Pick<SheetData, 'rows' | 'cols' | 'styles' | 'merges' | 'freeze' | 'autofilter' | 'hyperlinks' | 'validations' | 'sheetProtection' | 'images' | 'backgroundImage'> => {
    const rows: RowMap = {};
    const styleRegistry = new StyleRegistry();
    const hyperlinkParts: Record<string, { link: string; tooltip?: string }>[] = [];
    const sheetProtected = isWorksheetProtected(worksheet);
    const sheetProtection = readWorksheetProtection(worksheet);
    let maxCols = 0;
    let maxRow = 0;

    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (!row || row.cellCount === 0) return;
        const ri = rowNumber - 1;
        const cells: Record<number, CellData> = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            if (cell.isMerged && cell.address !== cell.master.address) return;

            const ci = colNumber - 1;
            const cellStyle = excelJsCellToStyle(cell);
            const text = formatCellText(cell, cellStyle?.format);
            const editable = readCellEditableFromExcel(cell, sheetProtected);
            const hl = readCellHyperlink(cell, ri, ci);
            if (!text && !cellStyle && editable === undefined && !Object.keys(hl).length) return;

            const styleIndex = styleRegistry.add(cellStyle);
            const cellData: CellData = { text };
            if (styleIndex != null) cellData.style = styleIndex;
            if (editable !== undefined) cellData.editable = editable;
            cells[ci] = cellData;
            if (ci + 1 > maxCols) maxCols = ci + 1;
            if (ri + 1 > maxRow) maxRow = ri + 1;
            if (Object.keys(hl).length) hyperlinkParts.push(hl);
        });
        if (Object.keys(cells).length > 0) {
            rows[ri] = { cells };
        }
        applyRowHeight(rows, ri, row);
    });

    const rowCount = Math.max(maxRow, worksheet.rowCount || 0);
    for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
        if (rows[rowNumber - 1]) continue;
        const excelRow = worksheet.getRow(rowNumber);
        if (excelRow.height == null) continue;
        applyRowHeight(rows, rowNumber - 1, excelRow);
        if (rowNumber > maxRow) maxRow = rowNumber;
    }

    const merges = readWorksheetMerges(worksheet);
    const sheetSize = { maxRow, maxCols };
    merges.forEach(merge => expandSizeForMerge(merge, sheetSize));
    maxRow = sheetSize.maxRow;
    maxCols = sheetSize.maxCols;

    const colCount = Math.max(maxCols, worksheet.columnCount || 0);
    const cols = buildColsFromWorksheet(worksheet, colCount);
    const styles = styleRegistry.getStyles();
    const sheetExtras = readSheetExtras(worksheet);
    const hyperlinks = mergeHyperlinkMaps(...hyperlinkParts);
    const validations = readWorksheetValidations(worksheet);
    const images = readWorksheetImages(worksheet, workbook);
    const backgroundImage = readWorksheetBackgroundImage(worksheet, workbook);

    return {
        rows: { len: maxRow, ...rows },
        cols: { len: colCount, ...cols },
        styles: styles.length > 0 ? styles : undefined,
        merges: merges.length > 0 ? merges : undefined,
        ...(Object.keys(hyperlinks).length ? { hyperlinks } : {}),
        ...(validations.length ? { validations } : {}),
        ...(sheetProtection ? { sheetProtection } : {}),
        ...(images.length ? { images } : {}),
        ...(backgroundImage ? { backgroundImage } : {}),
        ...sheetExtras,
    };
};

const convertExcelJsWorkbook = (
    workbook: ExcelJS.Workbook,
    sortStateXmlMap?: Map<number, ReturnType<typeof readWorksheetSortStateXml>>,
): ExcelData => {
    const sheets: SheetData[] = [];
    let maxLength = 0;
    let maxCols = 26;

    workbook.worksheets.forEach((worksheet, index) => {
        const converted = convertExcelJsWorksheet(worksheet, workbook);
        const xmlAutofilter = sortStateXmlMap?.get(index);
        if (xmlAutofilter?.sort && converted.autofilter?.ref) {
            converted.autofilter.sort = xmlAutofilter.sort;
        }
        const rowCount = converted.rows?.len ?? 0;
        if (maxLength < rowCount) maxLength = rowCount;

        const colLen = converted.cols?.len ?? 0;
        if (colLen > maxCols) maxCols = colLen;

        sheets.push({
            name: worksheet.name,
            sourceSheetId: worksheet.id,
            rows: converted.rows,
            cols: converted.cols,
            ...(converted.styles ? { styles: converted.styles } : {}),
            ...(converted.merges ? { merges: converted.merges } : {}),
            ...(converted.freeze ? { freeze: converted.freeze } : {}),
            ...(converted.autofilter ? { autofilter: converted.autofilter } : {}),
            ...(converted.hyperlinks ? { hyperlinks: converted.hyperlinks } : {}),
            ...(converted.validations ? { validations: converted.validations } : {}),
            ...(converted.sheetProtection ? { sheetProtection: converted.sheetProtection } : {}),
            ...(converted.images ? { images: converted.images } : {}),
            ...(converted.backgroundImage ? { backgroundImage: converted.backgroundImage } : {}),
        });
    });

    return { sheets, maxLength, maxCols };
};

const loadWithExcelJs = async (buffer: ArrayBuffer): Promise<ExcelData> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sortStateXmlMap = await readWorkbookSortStateXml(buffer);
    return convertExcelJsWorkbook(workbook, sortStateXmlMap);
};

const sheetJsColWidthToPx = (col?: XLSX.ColInfo) => {
    if (!col) return null;
    if (col.wpx != null) return col.wpx;
    if (col.wch != null) return col.wch * CHAR_WIDTH;
    if (col.width != null) return col.width * CHAR_WIDTH;
    return null;
};

const buildColsFromSheetJsWorksheet = (worksheet: XLSX.WorkSheet, colCount: number) => {
    const cols: Record<number, { width: number }> = {};
    const sheetCols = worksheet['!cols'];
    for (let i = 0; i < colCount; i += 1) {
        const width = sheetJsColWidthToPx(sheetCols?.[i]) ?? DEFAULT_COL_WIDTH;
        cols[i] = { width: clampColWidth(width) };
    }
    return cols;
};

/** Raw cell content (formula, number, date) instead of the formatted text, so that a save keeps it. */
const formatSheetJsCell = (cell: XLSX.CellObject, format: string | undefined, date1904: boolean) => {
    if (cell.f) return `=${cell.f}`;
    if (cell.v == null) return '';
    if (cell.t === 'n' && typeof cell.v === 'number') {
        return isDateFormat(format) ? formatExcelDate(serialToDate(cell.v, date1904), format) : String(cell.v);
    }
    if (cell.t === 'b') return cell.v ? 'TRUE' : 'FALSE';
    if (cell.t === 'e') return cell.w ?? '';
    return String(cell.v);
};

const convertSheetJsWorksheet = (worksheet: XLSX.WorkSheet, date1904: boolean): Pick<SheetData, 'rows' | 'cols' | 'merges' | 'styles'> => {
    const rows: RowMap = {};
    const styleRegistry = new StyleRegistry();
    let maxCols = 0;
    let maxRow = 0;
    const ref = worksheet['!ref'];
    if (!ref) {
        return { rows: { len: 0 }, cols: { len: 0 } };
    }

    const range = XLSX.utils.decode_range(ref);
    for (let ri = range.s.r; ri <= range.e.r; ri += 1) {
        const cells: Record<number, CellData> = {};
        let hasContent = false;
        for (let ci = range.s.c; ci <= range.e.c; ci += 1) {
            const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
            const cell = worksheet[addr];
            if (!cell) continue;
            const format = typeof cell.z === 'string' ? numFmtToSpreadsheetFormat(cell.z) : undefined;
            const text = formatSheetJsCell(cell, format, date1904);
            if (!text) continue;
            const styleIndex = styleRegistry.add(format ? { format } : null);
            cells[ci] = styleIndex != null ? { text, style: styleIndex } : { text };
            hasContent = true;
            if (ci + 1 > maxCols) maxCols = ci + 1;
            if (ri + 1 > maxRow) maxRow = ri + 1;
        }
        if (hasContent) {
            rows[ri] = { cells };
        }
    }

    const sheetSize = { maxRow, maxCols };
    (worksheet['!merges'] ?? []).forEach(merge => expandSizeForSheetJsMerge(merge, sheetSize));
    maxRow = sheetSize.maxRow;
    maxCols = sheetSize.maxCols;

    const colCount = Math.max(maxCols, range.e.c - range.s.c + 1);
    const merges = readSheetJsMerges(worksheet);
    return {
        rows: { len: maxRow, ...rows },
        cols: { len: colCount, ...buildColsFromSheetJsWorksheet(worksheet, colCount) },
        merges: merges.length > 0 ? merges : undefined,
        styles: styleRegistry.getStyles(),
    };
};

const convertSheetJsWorkbook = (workbook: XLSX.WorkBook): ExcelData => {
    const sheets: SheetData[] = [];
    let maxLength = 0;
    let maxCols = 26;

    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    for (const sheetName of workbook.SheetNames) {
        const converted = convertSheetJsWorksheet(workbook.Sheets[sheetName], date1904);
        const rowCount = converted.rows?.len ?? 0;
        if (maxLength < rowCount) maxLength = rowCount;

        const colLen = converted.cols?.len ?? 0;
        if (colLen > maxCols) maxCols = colLen;

        sheets.push({
            name: sheetName,
            rows: converted.rows,
            cols: converted.cols,
            ...(converted.styles?.length ? { styles: converted.styles } : {}),
            ...(converted.merges ? { merges: converted.merges } : {}),
        });
    }

    return { sheets, maxLength, maxCols };
};

const loadWithSheetJs = (buffer: ArrayBuffer): ExcelData => {
    const workbook = XLSX.read(buffer, { type: 'array', cellNF: true });
    return convertSheetJsWorkbook(workbook);
};

const loadCsv = (buffer: ArrayBuffer): ExcelData => {
    let maxCols = 26;
    const emptySheet = { maxCols, sheets: [{ name: 'Sheet1', rows: { len: 0 } }] };
    let csvStr = decodeCsvBuffer(buffer);
    if (!csvStr) return emptySheet;

    try {
        const leadingEmptyRows = csvStr.match(/^(?:\r\n|\n|\r)+/)?.[0].match(/\r\n|\n|\r/g)?.length ?? 0;
        const csvToParse = leadingEmptyRows > 0 ? csvStr.replace(/^(?:\r\n|\n|\r)+/, '') : csvStr;
        if (!csvToParse) {
            return {
                maxCols,
                maxLength: leadingEmptyRows,
                sheets: [{
                    name: 'Sheet1',
                    rows: { len: leadingEmptyRows },
                }],
            };
        }
        let parseInput = csvToParse;
        if (!parseInput.includes('\n')) parseInput += '\n';
        let schema = inferSchema(parseInput, { header: () => [] });
        if (!schema.col) {
            // no delimiter found: a single-column file, parsed as comma separated (it has no comma)
            schema = inferSchema(parseInput, { header: () => [], col: ',' });
        }
        const rows: string[][] = initParser(schema).stringArrs(parseInput);
        // the parser returns the final line break as an extra empty row
        while (rows.length > 0 && rows[rows.length - 1].length <= 1 && !rows[rows.length - 1][0]) {
            rows.pop();
        }
        const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);

        const processedRows: RowMap = {};
        for (let i = 0; i < leadingEmptyRows; i += 1) {
            processedRows[i] = { cells: {} };
        }
        for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i];
            const cells: Record<number, CellData> = {};
            for (let j = 0; j < row.length; j += 1) {
                cells[j] = { text: row[j] == null ? '' : String(row[j]) };
                if (j + 1 > maxCols) maxCols = j + 1;
            }
            processedRows[i + leadingEmptyRows] = { cells };
        }
        const csvRows = [
            ...Array.from({ length: leadingEmptyRows }, () => [] as string[]),
            ...rows,
        ];

        return {
            maxCols,
            maxLength: csvRows.length,
            csvDelimiter: schema.col,
            sheets: [{
                name: 'Sheet1',
                rows: { len: csvRows.length, ...processedRows },
                cols: { len: colCount, ...buildCsvCols(csvRows, colCount) },
            }],
        };
    } catch (error) {
        console.error(error);
        return { maxCols, sheets: [{ name: 'Sheet1', rows: { len: 1, 0: { cells: { 0: { text: error.message } } } } }] };
    }
};

const isCsvExt = (ext: string) => /csv|tsv/.test(ext.toLowerCase());
const isOdsExt = (ext: string) => ['ods', 'ots'].includes(ext.toLowerCase().replace(/^\./, ''));
// xlt 与 xls 同为 BIFF 格式，模板仅由扩展名区分
const isXlsExt = (ext: string) => ['xls', 'xlt'].includes(ext.toLowerCase().replace(/^\./, ''));
const isMacroExt = (ext: string) => ['xlsm', 'xltm'].includes(ext.toLowerCase().replace(/^\./, ''));

export async function loadSheets(buffer: ArrayBuffer, ext: string): Promise<ExcelData> {
    if (isCsvExt(ext)) {
        return loadCsv(buffer);
    }
    if (isXlsExt(ext) || isOdsExt(ext)) {
        return loadWithSheetJs(buffer);
    }
    const data = await loadWithExcelJs(buffer);
    if (isMacroExt(ext)) {
        const codeNames = await readSheetCodeNames(buffer);
        for (const sheet of data.sheets) {
            const codeName = sheet.name ? codeNames[sheet.name] : undefined;
            if (codeName) {
                sheet.codeName = codeName;
            }
        }
    }
    return data;
}

export function readCSV(buffer: ArrayBuffer): ExcelData {
    return loadCsv(buffer);
}

export async function readExcel(buffer: ArrayBuffer): Promise<ExcelData> {
    return loadWithExcelJs(buffer);
}
