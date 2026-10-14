import ExcelJS from '@cweijan/exceljs';
import JSZip from 'jszip';
import { handler } from "../../util/vscode";
import * as XLSX from 'xlsx';
import Spreadsheet from './x-spreadsheet/index';
import type { RowData, SheetData } from './x-spreadsheet/index';
import { CsvEncoding, encodeCsvText } from './csvEncoding';
import { DEFAULT_ROW_HEIGHT_PX, freezeExprToExcelView, pxToExcelRowHeight } from './excel_meta';
import { patchWorksheetSortStateXml } from './excel_sort_state';
import { applySpreadsheetStyle } from './excel_styles';
import { hyperlinkKey, writeCellHyperlink, type SpreadsheetHyperlink } from './excel_hyperlink';
import { writeWorksheetValidations } from './excel_validation';
import { writeWorksheetProtection } from './excel_protection';
import { writeWorksheetImages } from './excel_images';
import { extractVbaParts, injectVbaParts, type VbaParts } from './spreadsheet_vba';

const DEFAULT_COL_WIDTH = 100;

export { buildFormattingSnapshot, hasFormattingChanged } from './excel_meta';

export interface ExportOptions {
    /** 通过另存为对话框保存，而非覆盖当前文件 */
    saveAs?: boolean;
    /** saveAs 时指定目标格式 */
    saveAsExt?: string;
    /** 目标扩展名，决定 [Content_Types].xml 中工作簿主部件的类型 (xltx/xlsm/xltm) */
    targetExt?: string;
    /** 当前打开文件的原始内容；保存为 xlsm 时从中带回宏 (vbaProject.bin) */
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

function getColWidth(cols: SheetData['cols'], ci: number) {
    const col = cols?.[ci];
    if (col && typeof col === 'object' && col.width != null) return col.width;
    return DEFAULT_COL_WIDTH;
}

function pxToExcelColWidth(px: number) {
    return Math.max((px - 5) / 7, 0);
}

function setCellValue(cell: ExcelJS.Cell, text: string) {
    if (!text) {
        cell.value = null;
        return;
    }
    if (text.startsWith('=')) {
        cell.value = { formula: text.slice(1) };
        return;
    }
    const num = Number(text);
    if (text.trim() !== '' && !Number.isNaN(num) && String(num) === text.trim()) {
        cell.value = num;
        return;
    }
    cell.value = text;
}

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

async function writeSheetToExcelJs(worksheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, sheetData: SheetData) {
    const { rows, cols, styles = [], merges = [], hyperlinks = {}, validations } = sheetData;

    if (cols?.len) {
        for (let ci = 0; ci < cols.len; ci += 1) {
            worksheet.getColumn(ci + 1).width = pxToExcelColWidth(getColWidth(cols, ci));
        }
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
                setCellValue(excelCell, cellData.text ?? '');
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

async function patchWorkbookSortStates(buffer: Uint8Array, sheets: SheetData[], targetExt?: string, vba?: VbaParts | null) {
    const zip = await JSZip.loadAsync(buffer);
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
    const workbook = new ExcelJS.Workbook();
    for (let i = 0; i < sheets.length; i += 1) {
        const sheetData = sheets[i];
        const worksheet = workbook.addWorksheet(sheetData.name || `Sheet${i + 1}`);
        await writeSheetToExcelJs(worksheet, workbook, sheetData);
    }
    const buffer = new Uint8Array(await workbook.xlsx.writeBuffer());
    const keepsMacros = options?.targetExt === 'xlsm' || options?.targetExt === 'xltm';
    const vba = keepsMacros && options?.vbaSource ? await extractVbaParts(options.vbaSource) : null;
    const patched = await patchWorkbookSortStates(buffer, sheets, options?.targetExt, vba);
    await emitSave(patched, options);
}

function applyColWidths(ws: XLSX.WorkSheet, xws: SheetData) {
    const cols = xws.cols;
    if (!cols?.len) return;
    const colWidths = [];
    for (let ci = 0; ci < cols.len; ci += 1) {
        colWidths.push({ wpx: getColWidth(cols, ci) });
    }
    ws['!cols'] = colWidths;
}

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
        XLSX.utils.book_append_sheet(workbook, dataToSheetJs(sheetData), sheetData.name || `Sheet${i + 1}`);
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
