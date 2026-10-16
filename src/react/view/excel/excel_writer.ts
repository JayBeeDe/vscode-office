import ExcelJS from '@cweijan/exceljs';
import JSZip from 'jszip';
import { handler } from "../../util/vscode";
import * as XLSX from 'xlsx';
import Spreadsheet from './x-spreadsheet/index';
import type { CellStyle, RowData, SheetData } from './x-spreadsheet/index';
import { CsvEncoding, encodeCsvText } from './csvEncoding';
import { DEFAULT_ROW_HEIGHT_PX, freezeExprToExcelView, pxToExcelRowHeight } from './excel_meta';
import { patchWorksheetSortStateXml } from './excel_sort_state';
import { applySpreadsheetStyle, excelJsCellToStyle, resolveStyleNumFmt } from './excel_styles';
import { hyperlinkKey, writeCellHyperlink, type SpreadsheetHyperlink } from './excel_hyperlink';
import { writeWorksheetValidations } from './excel_validation';
import { writeWorksheetProtection } from './excel_protection';
import { writeWorksheetImages } from './excel_images';
import { extractVbaParts, injectVbaParts, type VbaParts } from './spreadsheet_vba';
import { dateToSerial, parseExcelDateText } from './excel_dates';
import { formatCellText } from './excel_reader';


export { buildFormattingSnapshot, hasFormattingChanged } from './excel_meta';

export interface ExportOptions {
    /** 通过另存为对话框保存，而非覆盖当前文件 */
    saveAs?: boolean;
    /** saveAs 时指定目标格式 */
    saveAsExt?: string;
    /** 目标扩展名，决定 [Content_Types].xml 中工作簿主部件的类型 (xltx/xlsm/xltm) */
    targetExt?: string;
    /** 当前打开文件的原始内容；保存为 xlsm 时从中带回宏 (vbaProject.bin)，xlsx 系列在其基础上原地更新 */
    vbaSource?: ArrayBuffer;
}

const WORKBOOK_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
/** ExcelJS 总是写出普通工作簿类型；这些扩展名需改写主部件类型，否则 Excel 会报扩展名与格式不符 */
const MAIN_CONTENT_TYPES: Record<string, string> = {
    xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
    xltm: 'application/vnd.ms-excel.template.macroEnabled.main+xml',
};
const ODS_MEDIA_TYPE = 'application/vnd.oasis.opendocument.spreadsheet';
const OTS_MEDIA_TYPE = 'application/vnd.oasis.opendocument.spreadsheet-template';

/** SheetJS 负责写出的格式；模板 (xlt/ots) 与基础格式 (xls/ods) 结构相同 */
const SHEETJS_BOOK_TYPES: Record<string, XLSX.BookType> = { xls: 'xls', xlt: 'xls', ods: 'ods', ots: 'ods' };

function isRowData(row: RowData | number | undefined): row is RowData {
    return row != null && typeof row === 'object';
}

/** Width set on the column, or undefined when it uses the sheet default. */
function getExplicitColWidth(cols: SheetData['cols'], ci: number): number | undefined {
    const col = cols?.[ci];
    return col && typeof col === 'object' && col.width != null ? col.width : undefined;
}

function isColHidden(cols: SheetData['cols'], ci: number): boolean {
    const col = cols?.[ci] as { hide?: boolean } | number | undefined;
    return !!col && typeof col === 'object' && col.hide === true;
}

function pxToExcelColWidth(px: number) {
    return Math.max((px - 5) / 7, 0);
}

/**
 * A cell text is a formula when it starts with a single `=` followed by something; text-formatted
 * cells and texts such as "=== header ===" stay text.
 */
function isFormulaText(text: string, format?: string): boolean {
    return format !== 'text' && /^=[^=]/.test(text) && text.slice(1).trim() !== '';
}

function setCellValue(cell: ExcelJS.Cell, text: string, format?: string) {
    if (!text) {
        cell.value = null;
        return;
    }
    const date = parseExcelDateText(text, format);
    if (date) {
        cell.value = date;
        return;
    }
    if (isFormulaText(text, format)) {
        cell.value = { formula: text.slice(1) };
        return;
    }
    const num = Number(text);
    // compared untrimmed: " 42 " stays text
    if (text.trim() !== '' && !Number.isNaN(num) && String(num) === text) {
        cell.value = num;
        return;
    }
    if (/^(TRUE|FALSE)$/i.test(text)) {
        cell.value = text.toUpperCase() === 'TRUE';
        return;
    }
    if (EXCEL_ERRORS.has(text)) {
        cell.value = { error: text } as ExcelJS.CellErrorValue;
        return;
    }
    cell.value = text;
}

const EXCEL_ERRORS = new Set(['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#NULL!', '#SPILL!', '#CALC!', '#GETTING_DATA']);

/** Original cell values of a reused worksheet, with the text the viewer showed for them. */
type OriginalCells = Map<string, { value: ExcelJS.CellValue; text: string }>;

const cellKey = (ri: number, ci: number) => `${ri}:${ci}`;

function applySheetMeta(worksheet: ExcelJS.Worksheet, sheetData: SheetData) {
    if (sheetData.freeze) {
        const frozen = freezeExprToExcelView(sheetData.freeze);
        if (frozen) {
            worksheet.views = [{
                state: 'frozen',
                xSplit: frozen.xSplit,
                ySplit: frozen.ySplit,
                topLeftCell: sheetData.freeze,
            }];
        }
    }

    const autofilter = sheetData.autofilter;
    if (autofilter?.ref) {
        worksheet.autoFilter = autofilter.ref;
    }
}

function writeRowHeights(worksheet: ExcelJS.Worksheet, rows: SheetData['rows']) {
    if (!rows?.len) return;
    for (let ri = 0; ri < rows.len; ri += 1) {
        const row = rows[ri];
        if (!isRowData(row) || row.height == null) continue;
        if (Math.abs(row.height - DEFAULT_ROW_HEIGHT_PX) < 1) continue;
        worksheet.getRow(ri + 1).height = pxToExcelRowHeight(row.height);
    }
}

type ExcelJsWorksheetInternals = ExcelJS.Worksheet & {
    _merges?: Record<string, { range?: string } | string>;
    _media?: unknown[];
    dataValidations?: { model?: Record<string, unknown> };
};

/**
 * Prepare a worksheet loaded from the original file for a rewrite: everything the viewer edits
 * is cleared, while what it doesn't read (notes, conditional formatting, print setup, sheet
 * state, tab colour...) is kept.
 */
function resetWorksheetForRewrite(worksheet: ExcelJS.Worksheet, sheetData: SheetData): OriginalCells {
    const ws = worksheet as ExcelJsWorksheetInternals;
    const originals: OriginalCells = new Map();
    const existingMerges = Object.values(ws._merges ?? {}) as ({ range?: string } | string)[];
    for (const merge of existingMerges) {
        const range = typeof merge === 'string' ? merge : merge?.range;
        if (range) worksheet.unMergeCells(range);
    }
    const rows = sheetData.rows;
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            const rowData = rows?.[rowNumber - 1];
            const kept = isRowData(rowData) && rowData.cells?.[colNumber - 1] != null;
            if (kept && cell.value != null) {
                originals.set(cellKey(rowNumber - 1, colNumber - 1), {
                    value: cell.value,
                    text: formatCellText(cell, excelJsCellToStyle(cell)?.format),
                });
            }
            cell.value = null;
            if (!kept) {
                cell.style = {};
            }
        });
    });
    if (ws.dataValidations) {
        ws.dataValidations.model = {};
    }
    ws._media = [];
    if (!sheetData.freeze && worksheet.views?.some(view => view.state === 'frozen')) {
        worksheet.views = worksheet.views.map(view => (view.state === 'frozen'
            ? { ...view, state: 'normal', xSplit: undefined, ySplit: undefined, topLeftCell: undefined } as ExcelJS.WorksheetView
            : view));
    }
    if (!sheetData.autofilter?.ref) {
        (worksheet as { autoFilter?: unknown }).autoFilter = undefined;
    }
    return originals;
}

function quoteSheetName(name: string) {
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Point defined names at the new names of renamed sheets. */
function renameSheetsInDefinedNames(workbook: ExcelJS.Workbook, renamed: Map<string, string>) {
    const definedNames = workbook.definedNames as unknown as { model: { name: string; ranges: string[] }[] };
    definedNames.model = definedNames.model.map(entry => ({
        ...entry,
        ranges: entry.ranges.map((range) => {
            const match = /^(?:'((?:[^']|'')+)'|([^!]+))!(.*)$/.exec(range);
            if (!match) return range;
            const sheetName = match[1] != null ? match[1].replace(/''/g, "'") : match[2];
            const next = renamed.get(sheetName);
            return next ? `${quoteSheetName(next)}!${match[3]}` : range;
        }),
    }));
}

/** Workbook to write: the original one when available, so that what isn't edited is kept. */
async function prepareWorkbook(sheets: SheetData[], source?: ArrayBuffer) {
    const workbook = new ExcelJS.Workbook();
    let loaded = false;
    if (source) {
        try {
            await workbook.xlsx.load(source);
            loaded = true;
        } catch {
            loaded = false;
        }
    }
    const targets: { worksheet: ExcelJS.Worksheet; reused: boolean }[] = [];
    if (!loaded) {
        const fresh = new ExcelJS.Workbook();
        sheets.forEach((sheetData, i) => {
            targets.push({ worksheet: fresh.addWorksheet(sheetData.name || `Sheet${i + 1}`), reused: false });
        });
        return { workbook: fresh, targets };
    }

    const claimed = new Map<number, ExcelJS.Worksheet>();
    const claims = sheets.map((sheetData) => {
        const id = sheetData.sourceSheetId;
        const worksheet = id != null && !claimed.has(id) ? workbook.getWorksheet(id) : undefined;
        if (worksheet) claimed.set(worksheet.id, worksheet);
        return worksheet;
    });
    for (const worksheet of workbook.worksheets) {
        if (!claimed.has(worksheet.id)) workbook.removeWorksheet(worksheet.id);
    }
    const renamed = new Map<string, string>();
    claims.forEach((worksheet, i) => {
        const name = sheets[i].name || `Sheet${i + 1}`;
        if (worksheet && worksheet.name !== name) renamed.set(worksheet.name, name);
    });
    // temporary names first, so that renames and new sheets never collide
    claims.forEach((worksheet, i) => { if (worksheet) worksheet.name = `__office_tmp_${i}`; });
    sheets.forEach((sheetData, i) => {
        const name = sheetData.name || `Sheet${i + 1}`;
        const worksheet = claims[i] ?? workbook.addWorksheet(`__office_new_${i}`);
        targets.push({ worksheet, reused: !!claims[i] });
        worksheet.name = name;
    });
    // number the sheets in display order: sheet files and VBA modules follow that order
    const internals = workbook as unknown as { _worksheets: (ExcelJS.Worksheet | undefined)[] };
    internals._worksheets = [undefined];
    targets.forEach(({ worksheet }, i) => {
        (worksheet as unknown as { id: number; orderNo: number }).id = i + 1;
        (worksheet as unknown as { id: number; orderNo: number }).orderNo = i + 1;
        internals._worksheets[i + 1] = worksheet;
    });
    if (renamed.size > 0) {
        renameSheetsInDefinedNames(workbook, renamed);
    }
    // images are written again from the sheet data
    (workbook as unknown as { media: unknown[] }).media = [];
    return { workbook, targets };
}

async function writeSheetToExcelJs(worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, sheetData: SheetData, originals?: OriginalCells) {
    const { rows, cols, styles = [], merges = [], hyperlinks = {}, validations } = sheetData;

    // only widths that are set: the others keep the sheet default
    const colCount = Math.max(cols?.len ?? 0, worksheet.columnCount);
    for (let ci = 0; ci < colCount; ci += 1) {
        const width = getExplicitColWidth(cols, ci);
        const column = worksheet.getColumn(ci + 1);
        if (width != null) column.width = pxToExcelColWidth(width);
        const hidden = isColHidden(cols, ci);
        if (hidden || column.hidden) column.hidden = hidden;
    }

    for (let i = 0; i < merges.length; i += 1) {
        worksheet.mergeCells(merges[i]);
    }

    applySheetMeta(worksheet, sheetData);
    writeRowHeights(worksheet, rows);
    writeWorksheetValidations(worksheet, validations);

    if (!rows) return;

    const rowLen = rows.len ?? 0;
    for (let ri = 0; ri < rowLen; ri += 1) {
        const row = rows[ri];
        if (!isRowData(row) || !row.cells) continue;
        for (const ciKey of Object.keys(row.cells)) {
            const ci = Number(ciKey);
            if (Number.isNaN(ci)) continue;
            const cellData = row.cells[ci];
            const excelCell = worksheet.getCell(ri + 1, ci + 1);
            const hl = hyperlinks[hyperlinkKey(ri, ci)] as SpreadsheetHyperlink | undefined;
            if (hl?.link) {
                writeCellHyperlink(excelCell, cellData.text ?? '', hl);
            } else {
                const original = originals?.get(cellKey(ri, ci));
                if (original && original.text === (cellData.text ?? '')) {
                    // not edited: keep the value as it was (rich text, formula result, type)
                    excelCell.value = original.value;
                } else {
                    setCellValue(excelCell, cellData.text ?? '', cellData.style != null ? styles[cellData.style]?.format : undefined);
                }
            }
            if (cellData.style != null && styles[cellData.style]) {
                applySpreadsheetStyle(excelCell, styles[cellData.style]);
            }
        }
    }

    writeWorksheetImages(worksheet, workbook, sheetData.images, sheetData.backgroundImage);
    await writeWorksheetProtection(worksheet, sheetData);
}

async function emitSave(buffer: Uint8Array, options?: ExportOptions) {
    const content = [...buffer];
    if (options?.saveAs) {
        handler.emit('saveAs', { content, ext: options.saveAsExt ?? 'xlsx' });
        return;
    }
    handler.emit('save', content);
}

const CUSTOM_PROPERTIES_PATH = 'docProps/custom.xml';
const CUSTOM_PROPERTIES_TYPE = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const CUSTOM_PROPERTIES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';

/** ExcelJS drops the custom document properties: copy them back from the original file. */
async function restoreCustomProperties(zip: JSZip, source: ArrayBuffer) {
    if (zip.file(CUSTOM_PROPERTIES_PATH)) return;
    let sourceZip: JSZip;
    try {
        sourceZip = await JSZip.loadAsync(source);
    } catch {
        return;
    }
    const custom = await sourceZip.file(CUSTOM_PROPERTIES_PATH)?.async('uint8array');
    const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
    const rels = await zip.file('_rels/.rels')?.async('string');
    if (!custom || !contentTypes || !rels) return;
    zip.file(CUSTOM_PROPERTIES_PATH, custom);
    if (!contentTypes.includes(`/${CUSTOM_PROPERTIES_PATH}`)) {
        zip.file('[Content_Types].xml', contentTypes.replace('</Types>',
            `<Override PartName="/${CUSTOM_PROPERTIES_PATH}" ContentType="${CUSTOM_PROPERTIES_TYPE}"/></Types>`));
    }
    if (!rels.includes(CUSTOM_PROPERTIES_REL)) {
        let id = 1;
        while (rels.includes(`Id="rId${id}"`)) id += 1;
        zip.file('_rels/.rels', rels.replace('</Relationships>',
            `<Relationship Id="rId${id}" Type="${CUSTOM_PROPERTIES_REL}" Target="${CUSTOM_PROPERTIES_PATH}"/></Relationships>`));
    }
}

async function patchWorkbookSortStates(buffer: Uint8Array, sheets: SheetData[], targetExt?: string, vba?: VbaParts | null, source?: ArrayBuffer) {
    const zip = await JSZip.loadAsync(buffer);
    if (source) {
        await restoreCustomProperties(zip, source);
    }
    for (let i = 0; i < sheets.length; i += 1) {
        const file = zip.file(`xl/worksheets/sheet${i + 1}.xml`);
        if (!file) continue;
        const xml = await file.async('string');
        zip.file(`xl/worksheets/sheet${i + 1}.xml`, patchWorksheetSortStateXml(xml, sheets[i].autofilter));
    }
    const mainContentType = targetExt ? MAIN_CONTENT_TYPES[targetExt] : undefined;
    if (mainContentType) {
        const contentTypes = zip.file('[Content_Types].xml');
        if (contentTypes) {
            const xml = await contentTypes.async('string');
            zip.file('[Content_Types].xml', xml.replace(WORKBOOK_CONTENT_TYPE, mainContentType));
        }
    }
    if (vba) {
        await injectVbaParts(zip, vba, sheets.map(sheet => sheet.codeName));
    }
    return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

async function exportWithExcelJs(sheets: SheetData[], options?: ExportOptions) {
    const { workbook, targets } = await prepareWorkbook(sheets, options?.saveAs ? undefined : options?.vbaSource);
    for (let i = 0; i < sheets.length; i += 1) {
        const { worksheet, reused } = targets[i];
        const originals = reused ? resetWorksheetForRewrite(worksheet, sheets[i]) : undefined;
        await writeSheetToExcelJs(worksheet, workbook, sheets[i], originals);
    }
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const keepsMacros = options?.targetExt === 'xlsm' || options?.targetExt === 'xltm';
    const vba = keepsMacros && options?.vbaSource ? await extractVbaParts(options.vbaSource) : null;
    const patched = await patchWorkbookSortStates(buffer, sheets, options?.targetExt, vba, options?.saveAs ? undefined : options?.vbaSource);
    await emitSave(patched, options);
}

function applyColWidths(ws: XLSX.WorkSheet, xws: SheetData) {
    const cols = xws.cols;
    if (!cols?.len) return;
    const colWidths: XLSX.ColInfo[] = [];
    for (let ci = 0; ci < cols.len; ci += 1) {
        const width = getExplicitColWidth(cols, ci);
        const info: XLSX.ColInfo = width != null ? { wpx: width } : {};
        if (isColHidden(cols, ci)) info.hidden = true;
        colWidths.push(info);
    }
    ws['!cols'] = colWidths;
}

/** Typed SheetJS cell for a spreadsheet cell: formulas, numbers and dates keep their type. */
function toSheetJsCell(text: string, style?: CellStyle): XLSX.CellObject {
    const format = style?.format;
    const numFmt = resolveStyleNumFmt(style);
    const withFormat = (cell: XLSX.CellObject): XLSX.CellObject => (numFmt ? { ...cell, z: numFmt } : cell);
    if (isFormulaText(text, format)) {
        return withFormat({ t: 'n', f: text.slice(1) });
    }
    const date = parseExcelDateText(text, format);
    if (date) {
        return withFormat({ t: 'n', v: dateToSerial(date) });
    }
    const num = Number(text);
    if (text.trim() !== '' && !Number.isNaN(num) && String(num) === text.trim()) {
        return withFormat({ t: 'n', v: num });
    }
    return { t: 's', v: text };
}

function dataToTypedSheetJs(xws: SheetData) {
    const ws: XLSX.WorkSheet = {};
    const rowobj = xws.rows;
    let maxRow = 0;
    let maxCol = 0;
    for (let ri = 0; ri < (rowobj?.len ?? 0); ri += 1) {
        const row = rowobj[ri];
        if (!isRowData(row)) continue;
        for (const ciKey of Object.keys(row.cells ?? {})) {
            const ci = Number(ciKey);
            if (Number.isNaN(ci)) continue;
            const cellData = row.cells[ci];
            if (!cellData.text) continue;
            const style = cellData.style != null ? xws.styles?.[cellData.style] : undefined;
            ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = toSheetJsCell(cellData.text, style);
            maxRow = Math.max(maxRow, ri);
            maxCol = Math.max(maxCol, ci);
        }
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
    if (xws.merges?.length) {
        ws['!merges'] = xws.merges.map(merge => XLSX.utils.decode_range(merge));
    }
    applyColWidths(ws, xws);
    return ws;
}

/** Plain-text sheet, used for CSV/TSV where every cell is written as it is shown. */
function dataToSheetJs(xws: SheetData) {
    const aoa: string[][] = [];
    const rowobj = xws.rows;
    if (!rowobj?.len) {
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        applyColWidths(ws, xws);
        return ws;
    }
    for (let ri = 0; ri < rowobj.len; ri += 1) {
        const row = rowobj[ri];
        if (!isRowData(row)) continue;
        aoa[ri] = [];
        for (const ciKey of Object.keys(row.cells ?? {})) {
            const ci = Number(ciKey);
            if (Number.isNaN(ci)) continue;
            aoa[ri][ci] = row.cells[ci].text;
        }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    applyColWidths(ws, xws);
    return ws;
}

/** ots = ods 改写 mimetype 与 manifest；mimetype 须为首个且不压缩的条目 */
async function toOdsTemplate(buffer: Uint8Array) {
    const source = await JSZip.loadAsync(buffer);
    const zip = new JSZip();
    zip.file('mimetype', OTS_MEDIA_TYPE, { compression: 'STORE' });
    for (const [path, entry] of Object.entries(source.files)) {
        if (path === 'mimetype' || entry.dir) continue;
        if (path === 'META-INF/manifest.xml') {
            const xml = await entry.async('string');
            zip.file(path, xml.replace(`manifest:media-type="${ODS_MEDIA_TYPE}"`, `manifest:media-type="${OTS_MEDIA_TYPE}"`));
            continue;
        }
        zip.file(path, await entry.async('uint8array'));
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function writeWithSheetJs(sheets: SheetData[], ext: string) {
    const workbook = XLSX.utils.book_new();
    for (let i = 0; i < sheets.length; i += 1) {
        const sheetData = sheets[i];
        XLSX.utils.book_append_sheet(workbook, dataToTypedSheetJs(sheetData), sheetData.name || `Sheet${i + 1}`);
    }
    const buffer = new Uint8Array(XLSX.write(workbook, { bookType: SHEETJS_BOOK_TYPES[ext], type: 'array' }));
    return ext === 'ots' ? toOdsTemplate(buffer) : buffer;
}

export async function exportSaveAs(
    spreadSheet: Spreadsheet,
    targetExt: string,
    csvEncoding: CsvEncoding = 'utf8',
    csvDelimiter: string = ',',
) {
    const ext = targetExt.replace('.', '').toLowerCase();
    const sheets = spreadSheet.getData();
    if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx' || ext === 'xltm') {
        await exportWithExcelJs(sheets, { saveAs: true, saveAsExt: ext, targetExt: ext });
        return;
    }
    if (SHEETJS_BOOK_TYPES[ext]) {
        handler.emit('saveAs', { content: [...await writeWithSheetJs(sheets, ext)], ext });
        return;
    }
    if (ext === 'csv' || ext === 'tsv') {
        const fs = ext === 'tsv' ? '\t' : csvDelimiter;
        const csvContent = XLSX.utils.sheet_to_csv(dataToSheetJs(sheets[0]), { FS: fs });
        const bytes = encodeCsvText(csvContent, csvEncoding);
        handler.emit('saveAs', { content: [...bytes], ext });
    }
}

export async function export_xlsx(
    spreadSheet: Spreadsheet,
    extName: string,
    csvEncoding: CsvEncoding = 'utf8',
    options?: ExportOptions,
    csvDelimiter: string = ',',
) {
    const ext = extName.replace('.', '').toLowerCase();
    const sheets = spreadSheet.getData();

    if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx' || ext === 'xltm' || options?.saveAs) {
        await exportWithExcelJs(sheets, options?.saveAs ? { saveAs: true } : { targetExt: ext, vbaSource: options?.vbaSource });
        return;
    }
    if (SHEETJS_BOOK_TYPES[ext]) {
        handler.emit('save', [...await writeWithSheetJs(sheets, ext)]);
        return;
    }
    if (ext === 'csv' || ext === 'tsv') {
        const fs = ext === 'tsv' ? '\t' : csvDelimiter;
        const csvContent = XLSX.utils.sheet_to_csv(dataToSheetJs(sheets[0]), { FS: fs });
        const bytes = encodeCsvText(csvContent, csvEncoding);
        handler.emit('save', [...bytes]);
    }
}
