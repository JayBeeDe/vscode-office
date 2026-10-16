import iconv from 'iconv-lite';

export type CsvEncoding = 'utf8' | 'gbk' | 'win1252';

function toUint8Array(buffer: ArrayBuffer): Uint8Array {
    return new Uint8Array(buffer);
}

function stripUtf8Bom(bytes: Uint8Array): Uint8Array {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return bytes.subarray(3);
    }
    return bytes;
}

export function isValidUtf8(buffer: ArrayBuffer): boolean {
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(toUint8Array(buffer));
        return true;
    } catch {
        return false;
    }
}

/**
 * Tell GBK from a Western single-byte encoding (Windows-1252, which covers Latin-1): Chinese
 * characters are pairs of high bytes, while accented Latin letters are single high bytes
 * mostly followed by ASCII.
 */
function looksLikeGbk(bytes: Uint8Array): boolean {
    let highPairs = 0;
    let singleHigh = 0;
    for (let i = 0; i < bytes.length; i += 1) {
        if (bytes[i] < 0x80) continue;
        const next = bytes[i + 1];
        if (bytes[i] >= 0x81 && bytes[i] <= 0xfe && next !== undefined && next >= 0x80 && next <= 0xfe) {
            highPairs += 1;
            i += 1;
        } else {
            singleHigh += 1;
        }
    }
    return highPairs > singleHigh;
}

export function detectCsvEncoding(buffer: ArrayBuffer): CsvEncoding {
    const bytes = toUint8Array(buffer);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        return 'utf8';
    }
    if (isValidUtf8(buffer)) {
        return 'utf8';
    }
    return looksLikeGbk(bytes) ? 'gbk' : 'win1252';
}

export function decodeCsvBuffer(buffer: ArrayBuffer): string {
    const encoding = detectCsvEncoding(buffer);
    if (encoding === 'utf8') {
        return new TextDecoder('utf-8').decode(stripUtf8Bom(toUint8Array(buffer)));
    }
    return iconv.decode(toUint8Array(buffer), encoding);
}

export function encodeCsvText(text: string, encoding: CsvEncoding): Uint8Array {
    if (encoding === 'utf8') {
        return new TextEncoder().encode(text);
    }
    return new Uint8Array(iconv.encode(text, encoding));
}
