import {
    parquetMetadataAsync,
    parquetReadObjects,
    parquetSchema,
    type AsyncBuffer,
    type FileMetaData,
    type SchemaElement,
    type SchemaTree,
} from 'hyparquet';
import { parquetWriteBuffer, type ColumnSource } from 'hyparquet-writer';

export interface ParquetColumnInfo {
    name: string;
    type: string;
    /** schema element of the top-level field */
    element: SchemaElement;
    /** a group (struct, list, map): shown as JSON, not editable */
    nested: boolean;
}

export interface ParquetFileInfo {
    file: AsyncBuffer;
    metadata: FileMetaData;
    columns: ParquetColumnInfo[];
    rowCount: number;
    createdBy?: string;
}

const PAGE_SIZE = 50;

export function getPageSize(): number {
    return PAGE_SIZE;
}

function asyncBufferFromArrayBuffer(buffer: ArrayBuffer): AsyncBuffer {
    return {
        byteLength: buffer.byteLength,
        slice(start: number, end?: number) {
            return buffer.slice(start, end ?? buffer.byteLength);
        },
    };
}

function formatSchemaType(element: SchemaElement): string {
    if (element.logical_type?.type) {
        return element.logical_type.type;
    }
    if (element.converted_type) {
        return element.converted_type;
    }
    return element.type ?? 'UNKNOWN';
}

function nestedTypeName(tree: SchemaTree): string {
    const { element } = tree;
    if (element.logical_type?.type === 'LIST' || element.converted_type === 'LIST') return 'LIST';
    if (element.logical_type?.type === 'MAP' || element.converted_type === 'MAP' || element.converted_type === 'MAP_KEY_VALUE') return 'MAP';
    if (element.repetition_type === 'REPEATED') return 'LIST';
    return 'STRUCT';
}

/**
 * One column per top-level field, as the rows are keyed: a struct, list or map is one column
 * (its leaf paths such as lst.list.element match no row key).
 */
export async function openParquetFile(buffer: ArrayBuffer): Promise<ParquetFileInfo> {
    const file = asyncBufferFromArrayBuffer(buffer);
    const metadata = await parquetMetadataAsync(file);
    const schemaTree = parquetSchema(metadata);
    const columns: ParquetColumnInfo[] = schemaTree.children.map((child) => {
        const nested = child.children.length > 0;
        return {
            name: child.element.name,
            type: nested ? nestedTypeName(child) : formatSchemaType(child.element),
            element: child.element,
            nested,
        };
    });
    return {
        file,
        metadata,
        columns,
        rowCount: Number(metadata.num_rows),
        createdBy: metadata.created_by,
    };
}

export async function readAllParquetRows(file: AsyncBuffer, metadata: FileMetaData): Promise<Record<string, unknown>[]> {
    const rowCount = Number(metadata.num_rows);
    if (rowCount <= 0) {
        return [];
    }
    return parquetReadObjects({
        file,
        metadata,
        rowStart: 0,
        rowEnd: rowCount,
        rowFormat: 'object',
    });
}

/** A flat value in the JavaScript type the writer expects for the column's physical type. */
function normalizeFlatValue(value: unknown, element: SchemaElement): unknown {
    if (value == null) return null;
    switch (element.type) {
        case 'BOOLEAN':
            return typeof value === 'boolean' ? value : /^(true|1|yes)$/i.test(String(value));
        case 'INT32':
            return typeof value === 'bigint' ? Number(value) : value;
        case 'INT64': {
            if (typeof value === 'bigint' || value instanceof Date) return value;
            if (typeof value === 'number') return BigInt(Math.trunc(value));
            return value;
        }
        case 'FLOAT':
        case 'DOUBLE':
            return typeof value === 'bigint' ? Number(value) : value;
        default:
            return value;
    }
}

/** Write the rows with the file's own schema, so nested columns and types are kept. */
export function writeParquetBuffer(info: ParquetFileInfo, rows: Record<string, unknown>[]): ArrayBuffer {
    const columnData: ColumnSource[] = info.columns.map(column => ({
        name: column.name,
        data: rows.map((row) => {
            const value = row[column.name] ?? null;
            return column.nested ? value : normalizeFlatValue(value, column.element);
        }) as ColumnSource['data'],
    }));
    const { metadata } = info;
    // the codec of the file when the writer has it (it ships snappy only), else snappy
    const fileCodec = metadata.row_groups[0]?.columns[0]?.meta_data?.codec;
    const codec = fileCodec === 'UNCOMPRESSED' || fileCodec === 'SNAPPY' ? fileCodec : 'SNAPPY';
    // the same row groups as the file (the last size repeats)
    const rowGroupSize = metadata.row_groups.map(group => Number(group.num_rows)).filter(size => size > 0);
    return parquetWriteBuffer({
        columnData,
        schema: metadata.schema,
        codec,
        ...(rowGroupSize.length ? { rowGroupSize } : {}),
        // pandas, Arrow and Spark keep their own schemas there
        ...(metadata.key_value_metadata?.length ? { kvMetadata: metadata.key_value_metadata } : {}),
    });
}

export function isColumnEditable(type: string): boolean {
    const upper = `${type}`.toUpperCase();
    if (upper.includes('STRUCT') || upper.includes('MAP') || upper.includes('LIST')) {
        return false;
    }
    return true;
}

export type ParsedCell = { ok: true; value: unknown } | { ok: false };

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/** The typed text as a value of the column's type, or not ok when it can't be one. */
export function parseCellInput(text: string, column: ParquetColumnInfo): ParsedCell {
    const trimmed = text.trim();
    if (!trimmed) return { ok: true, value: null };
    const physical = column.element.type;
    if (physical === 'INT32' && !column.element.converted_type?.startsWith('DATE')) {
        // the file stores 32-bit integers: a larger number can't be written
        const number = Number(trimmed);
        if (!Number.isInteger(number) || number < INT32_MIN || number > INT32_MAX) return { ok: false };
        return { ok: true, value: number };
    }
    return { ok: true, value: parseLooseCellInput(trimmed, column.type) };
}

function parseLooseCellInput(trimmed: string, type: string): unknown {
    const upper = `${type}`.toUpperCase();
    if (upper.includes('BOOL')) {
        if (/^(true|1|yes)$/i.test(trimmed)) return true;
        if (/^(false|0|no)$/i.test(trimmed)) return false;
        return trimmed;
    }
    if (upper.includes('INT') || upper.includes('FLOAT') || upper.includes('DOUBLE') || upper.includes('DECIMAL') || upper.includes('NUM')) {
        const number = Number(trimmed);
        if (isNaN(number)) return trimmed;
        if (upper.includes('INT') && !upper.includes('INTERVAL')) return Math.trunc(number);
        return number;
    }
    if (upper.includes('JSON') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
            return JSON.parse(trimmed);
        } catch {
            return trimmed;
        }
    }
    return trimmed;
}

export function formatCellValue(value: unknown): string {
    if (value == null) {
        return '';
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }
    return String(value);
}
