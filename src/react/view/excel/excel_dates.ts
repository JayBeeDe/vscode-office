/**
 * Date cells are shown and edited as ISO-like text and written back as real dates.
 * ExcelJS maps serial numbers to UTC dates, so only the UTC fields are used.
 */

const DATE_FORMATS = new Set(['date', 'time', 'datetime', 'duration']);
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const HOUR_MS = 3600 * 1000;

const pad = (value: number) => String(value).padStart(2, '0');

export function isDateFormat(format?: string): boolean {
    return !!format && DATE_FORMATS.has(format);
}

/** Text for a date cell, according to its spreadsheet format (date, time, datetime, duration). */
export function formatExcelDate(date: Date, format?: string): string {
    const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
    const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
    if (format === 'duration') {
        const totalSeconds = Math.round((date.getTime() - EXCEL_EPOCH) / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        return `${hours}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
    }
    if (format === 'time') return time;
    if (format === 'date') return day;
    if (format === 'datetime') return `${day} ${time}`;
    const hasTime = date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds();
    return hasTime ? `${day} ${time}` : day;
}

/** Date of an Excel serial number (1900 date system unless `date1904`). */
export function serialToDate(serial: number, date1904 = false): Date {
    return new Date(EXCEL_EPOCH + (serial + (date1904 ? 1462 : 0)) * 24 * HOUR_MS);
}

/** Excel serial number (1900 date system) of a date. */
export function dateToSerial(date: Date): number {
    return (date.getTime() - EXCEL_EPOCH) / (24 * HOUR_MS);
}

/** Parse the text of a date-formatted cell back into a date; null when it isn't a date. */
export function parseExcelDateText(text: string, format?: string): Date | null {
    if (!isDateFormat(format)) return null;
    const value = text.trim();
    const dateMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
    if (dateMatch) {
        const [, y, m, d, h = '0', mi = '0', s = '0'] = dateMatch;
        const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(mi), Number(s)));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const timeMatch = /^(\d{1,5}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (timeMatch && (format === 'time' || format === 'duration')) {
        const [, h, mi, s = '0'] = timeMatch;
        return new Date(EXCEL_EPOCH + Number(h) * HOUR_MS + Number(mi) * 60 * 1000 + Number(s) * 1000);
    }
    return null;
}
