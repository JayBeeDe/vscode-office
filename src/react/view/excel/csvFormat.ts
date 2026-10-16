/**
 * CSV/TSV parsing and writing that keep the file's layout: line endings, final line break,
 * blank lines, and quotes only where they are needed.
 */

export interface CsvFormat {
    bom: boolean;
    eol: string;
    trailingNewline: boolean;
}

export const DEFAULT_CSV_FORMAT: CsvFormat = { bom: false, eol: '\n', trailingNewline: false };

export function detectCsvFormat(text: string, bom: boolean): CsvFormat {
    const eol = /\r\n|\n|\r/.exec(text)?.[0] ?? '\n';
    return { bom, eol, trailingNewline: /(\r\n|\n|\r)$/.test(text) };
}

/** RFC 4180 parser; a quote only opens a quoted field at the start of the field. */
export function parseCsv(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let i = 0;
    let fieldStart = true;
    while (i < text.length) {
        const char = text[i];
        if (fieldStart && char === '"') {
            // quoted field
            i += 1;
            while (i < text.length) {
                if (text[i] === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                field += text[i];
                i += 1;
            }
            fieldStart = false;
            continue;
        }
        if (char === delimiter) {
            row.push(field);
            field = '';
            fieldStart = true;
            i += 1;
            continue;
        }
        if (char === '\r' || char === '\n') {
            row.push(field);
            rows.push(row.length === 1 && row[0] === '' ? [] : row);
            row = [];
            field = '';
            fieldStart = true;
            i += char === '\r' && text[i + 1] === '\n' ? 2 : 1;
            continue;
        }
        field += char;
        fieldStart = false;
        i += 1;
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function quoteField(value: string, delimiter: string): string {
    const needsQuotes = delimiter === '\t'
        // TSV: quotes inside a field are plain characters, only a leading one would be read as quoting
        ? /[\t\r\n]/.test(value) || value.startsWith('"')
        : value.includes(delimiter) || /["\r\n]/.test(value);
    return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeCsv(rows: string[][], delimiter: string, format: CsvFormat): string {
    const text = rows.map(row => row.map(value => quoteField(value, delimiter)).join(delimiter)).join(format.eol);
    return format.trailingNewline && rows.length > 0 ? text + format.eol : text;
}
