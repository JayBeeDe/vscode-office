import type * as ExcelJS from '@cweijan/exceljs';
import { expr2xy, xy2expr } from './x-spreadsheet/core/alphabet';

export interface SpreadsheetValidationItem {
    refs: string[];
    mode: string;
    type: string;
    required?: boolean;
    operator?: string;
    value?: string | string[] | number;
    /** original ExcelJS definition (JSON), written back while the viewer's fields are unchanged */
    source?: string;
}

/** Validation of a type the viewer doesn't support, kept to be written back. */
export interface ExtraValidation {
    ref: string;
    source: string;
}

type ValidationBounds = {
    sri: number;
    sci: number;
    eri: number;
    eci: number;
    count: number;
};

/** ExcelJS expands range sqref (e.g. E2:E1048576) into per-cell model keys; collapse back to ranges. */
function collapseExcelJsValidations(
    model: Record<string, ExcelJS.DataValidation>,
): [string, ExcelJS.DataValidation][] {
    const groups = new Map<ExcelJS.DataValidation, ValidationBounds>();
    for (const ref in model) {
        if (!Object.prototype.hasOwnProperty.call(model, ref)) continue;
        const dv = model[ref];
        if (!dv) continue;
        const [ci, ri] = expr2xy(ref);
        const bounds = groups.get(dv);
        if (!bounds) {
            groups.set(dv, {
                sri: ri, sci: ci, eri: ri, eci: ci, count: 1,
            });
            continue;
        }
        if (ri < bounds.sri) bounds.sri = ri;
        if (ci < bounds.sci) bounds.sci = ci;
        if (ri > bounds.eri) bounds.eri = ri;
        if (ci > bounds.eci) bounds.eci = ci;
        bounds.count += 1;
    }

    const items: [string, ExcelJS.DataValidation][] = [];
    for (const [dv, bounds] of groups) {
        const area = (bounds.eri - bounds.sri + 1) * (bounds.eci - bounds.sci + 1);
        if (bounds.count === area) {
            const start = xy2expr(bounds.sci, bounds.sri);
            const ref = bounds.count === 1
                ? start
                : `${start}:${xy2expr(bounds.eci, bounds.eri)}`;
            items.push([ref, dv]);
            continue;
        }
        // Multi-area / sparse: keep per-cell (small in practice)
        for (const ref in model) {
            if (!Object.prototype.hasOwnProperty.call(model, ref)) continue;
            if (model[ref] !== dv) continue;
            items.push([ref, dv]);
        }
    }
    return items;
}

type ExcelOperator = NonNullable<ExcelJS.DataValidation['operator']>;

const SS_TO_EXCEL_OPERATOR: Record<string, ExcelOperator> = {
    be: 'between',
    nbe: 'notBetween',
    eq: 'equal',
    neq: 'notEqual',
    lt: 'lessThan',
    lte: 'lessThanOrEqual',
    gt: 'greaterThan',
    gte: 'greaterThanOrEqual',
};

const EXCEL_TO_SS_OPERATOR: Record<string, string> = {
    between: 'be',
    notBetween: 'nbe',
    equal: 'eq',
    notEqual: 'neq',
    lessThan: 'lt',
    lessThanOrEqual: 'lte',
    greaterThan: 'gt',
    greaterThanOrEqual: 'gte',
};

function parseListFormula(raw: unknown): string {
    if (raw == null) return '';
    let text = String(raw).trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        text = text.slice(1, -1);
    }
    return text;
}

function toFormulaValue(value: string | number): string | number {
    if (typeof value === 'number') return value;
    const trimmed = value.trim();
    if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
    return trimmed;
}

function refTopLeft(ref: string): string {
    const idx = ref.indexOf(':');
    return idx === -1 ? ref : ref.slice(0, idx);
}

/** Excel custom validation: 11-digit mobile starting with 1–9 */
function buildPhoneFormula(cell: string): string {
    return `AND(LEN(${cell})=11,ISNUMBER(--${cell}),--LEFT(${cell},1)>=1)`;
}

/** Excel custom validation: basic email shape */
function buildEmailFormula(cell: string): string {
    return `AND(NOT(ISERROR(FIND("@",${cell}))),NOT(ISERROR(FIND(".",${cell},FIND("@",${cell})+1))),LEN(${cell})>=5)`;
}

function normalizeFormula(formula: string): string {
    return formula.trim().replace(/^=/, '').replace(/\$/g, '').toUpperCase();
}

function detectCustomValidationType(formula: string, ref: string): 'phone' | 'email' | null {
    const cell = refTopLeft(ref);
    const norm = normalizeFormula(formula);
    if (norm === normalizeFormula(buildPhoneFormula(cell))) return 'phone';
    if (norm === normalizeFormula(buildEmailFormula(cell))) return 'email';
    if (/LEN\([^)]+\)=11/.test(norm) && /ISNUMBER/.test(norm) && /--LEFT\([^)]+\)>=1/.test(norm)) {
        return 'phone';
    }
    if (/FIND\("@"/.test(norm) && /FIND\("\./.test(norm) && /LEN\([^)]+\)>=5/.test(norm)) {
        return 'email';
    }
    return null;
}

export function excelValidationToSpreadsheet(
    ref: string,
    dv: ExcelJS.DataValidation,
): SpreadsheetValidationItem | null {
    const mode = 'cell';
    if (dv.type === 'list') {
        return {
            refs: [ref],
            mode,
            type: 'list',
            required: !dv.allowBlank,
            value: parseListFormula(dv.formulae?.[0]),
        };
    }
    if ((dv.type === 'whole' || dv.type === 'decimal') && (!dv.operator || EXCEL_TO_SS_OPERATOR[dv.operator])) {
        const operator = dv.operator ? EXCEL_TO_SS_OPERATOR[dv.operator] : undefined;
        let value: string | string[] | number = '';
        if (dv.operator === 'between' || dv.operator === 'notBetween') {
            value = [String(dv.formulae?.[0] ?? ''), String(dv.formulae?.[1] ?? '')];
        } else {
            value = String(dv.formulae?.[0] ?? '');
        }
        return {
            refs: [ref],
            mode,
            type: 'number',
            required: !dv.allowBlank,
            operator,
            value,
        };
    }
    if (dv.type === 'date' && (!dv.operator || EXCEL_TO_SS_OPERATOR[dv.operator])) {
        const operator = dv.operator ? EXCEL_TO_SS_OPERATOR[dv.operator] : undefined;
        let value: string | string[] = '';
        if (dv.operator === 'between' || dv.operator === 'notBetween') {
            value = [String(dv.formulae?.[0] ?? ''), String(dv.formulae?.[1] ?? '')];
        } else {
            value = String(dv.formulae?.[0] ?? '');
        }
        return {
            refs: [ref],
            mode,
            type: 'date',
            required: !dv.allowBlank,
            operator,
            value,
        };
    }
    if (dv.type === 'custom') {
        const customType = detectCustomValidationType(String(dv.formulae?.[0] ?? ''), ref);
        if (customType) {
            return {
                refs: [ref],
                mode,
                type: customType,
                required: !dv.allowBlank,
                value: '',
            };
        }
    }
    return null;
}

function readValidationModel(worksheet: ExcelJS.Worksheet) {
    const model = (worksheet as { dataValidations?: { model?: Record<string, ExcelJS.DataValidation> } })
        .dataValidations?.model ?? {};
    return collapseExcelJsValidations(model);
}

export function readWorksheetValidations(worksheet: ExcelJS.Worksheet): SpreadsheetValidationItem[] {
    const items: SpreadsheetValidationItem[] = [];
    for (const [ref, dv] of readValidationModel(worksheet)) {
        const converted = excelValidationToSpreadsheet(ref, dv);
        if (converted) items.push({ ...converted, source: JSON.stringify(dv) });
    }
    return items;
}

/** Validations the viewer can't represent; they are kept as they are. */
export function readWorksheetExtraValidations(worksheet: ExcelJS.Worksheet): ExtraValidation[] {
    return readValidationModel(worksheet)
        .filter(([ref, dv]) => !excelValidationToSpreadsheet(ref, dv))
        .map(([ref, dv]) => ({ ref, source: JSON.stringify(dv) }));
}

/** The original definition when the viewer's fields still match it, so nothing is lost. */
function unchangedSource(item: SpreadsheetValidationItem, ref: string): ExcelJS.DataValidation | null {
    if (!item.source) return null;
    try {
        const source = JSON.parse(item.source) as ExcelJS.DataValidation;
        const mapped = excelValidationToSpreadsheet(ref, source);
        if (mapped && mapped.type === item.type && mapped.required === item.required
            && mapped.operator === item.operator && JSON.stringify(mapped.value) === JSON.stringify(item.value)) {
            return source;
        }
    } catch {
        // fall back to the viewer's fields
    }
    return null;
}

const MESSAGE_KEYS = ['showErrorMessage', 'showInputMessage', 'errorStyle', 'errorTitle', 'error', 'promptTitle', 'prompt'] as const;

function sourceMessages(source: string): Partial<ExcelJS.DataValidation> {
    try {
        const parsed = JSON.parse(source) as Record<string, unknown>;
        const messages: Record<string, unknown> = {};
        for (const key of MESSAGE_KEYS) {
            if (parsed[key] != null) messages[key] = parsed[key];
        }
        return messages as Partial<ExcelJS.DataValidation>;
    } catch {
        return {};
    }
}

/** A list source that is a range, another sheet's range or a defined name: written without quotes. */
const LIST_REFERENCE = /^=?(?:(?:'[^']+'|[A-Za-z0-9_.]+)!)?(?:\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|[A-Za-z_][A-Za-z0-9_.]*)$/;

export function spreadsheetValidationToExcel(
    item: SpreadsheetValidationItem,
    ref?: string,
): ExcelJS.DataValidation | null {
    const { type, operator, value, required } = item;
    const allowBlank = !required;

    if (type === 'list') {
        const list = Array.isArray(value) ? value.join(',') : String(value ?? '');
        if (!list.includes(',') && LIST_REFERENCE.test(list)) {
            return { type: 'list', allowBlank, formulae: [list.replace(/^=/, '')] };
        }
        return {
            type: 'list',
            allowBlank,
            formulae: [`"${list}"`],
        };
    }
    if (type === 'number') {
        // a whole-number rule stays whole when its bounds are edited
        const sourceType = item.source ? (JSON.parse(item.source) as ExcelJS.DataValidation).type : undefined;
        const numberType: 'whole' | 'decimal' = sourceType === 'whole' ? 'whole' : 'decimal';
        const excelOp = operator ? SS_TO_EXCEL_OPERATOR[operator] : undefined;
        if (excelOp === 'between' || excelOp === 'notBetween') {
            const arr = Array.isArray(value) ? value : ['', ''];
            return {
                type: numberType,
                allowBlank,
                operator: excelOp,
                formulae: [toFormulaValue(arr[0]), toFormulaValue(arr[1])],
            };
        }
        return {
            type: numberType,
            allowBlank,
            operator: excelOp,
            formulae: [toFormulaValue(Array.isArray(value) ? value[0] : String(value ?? ''))],
        };
    }
    if (type === 'date') {
        const excelOp = operator ? SS_TO_EXCEL_OPERATOR[operator] : undefined;
        if (excelOp === 'between' || excelOp === 'notBetween') {
            const arr = Array.isArray(value) ? value : ['', ''];
            return {
                type: 'date',
                allowBlank,
                operator: excelOp,
                formulae: [arr[0], arr[1]],
            };
        }
        return {
            type: 'date',
            allowBlank,
            operator: excelOp,
            formulae: [Array.isArray(value) ? value[0] : String(value ?? '')],
        };
    }
    if (type === 'email' || type === 'phone') {
        const cell = refTopLeft(ref ?? item.refs[0] ?? 'A1');
        const formula = type === 'phone' ? buildPhoneFormula(cell) : buildEmailFormula(cell);
        return {
            type: 'custom',
            allowBlank,
            formulae: [`=${formula}`],
        };
    }
    return null;
}

export function writeWorksheetValidations(
    worksheet: ExcelJS.Worksheet,
    items: SpreadsheetValidationItem[] | undefined,
    extra?: ExtraValidation[],
) {
    if (!items?.length && !extra?.length) return;
    const dv = (worksheet as { dataValidations?: { add: (ref: string, v: ExcelJS.DataValidation) => void } })
        .dataValidations;
    if (!dv?.add) return;
    for (const item of items ?? []) {
        for (let j = 0; j < item.refs.length; j += 1) {
            const sheetRef = item.refs[j];
            let excelDv = unchangedSource(item, sheetRef);
            if (!excelDv) {
                excelDv = spreadsheetValidationToExcel(item, sheetRef);
                if (excelDv && item.source) {
                    // an edited rule keeps its messages
                    excelDv = { ...sourceMessages(item.source), ...excelDv };
                }
            }
            if (!excelDv) continue;
            dv.add(sheetRef, excelDv);
        }
    }
    for (const { ref, source } of extra ?? []) {
        try {
            dv.add(ref, JSON.parse(source) as ExcelJS.DataValidation);
        } catch {
            // skip a broken entry
        }
    }
}
