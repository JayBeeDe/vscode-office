import type * as ExcelJS from '@cweijan/exceljs';

export type SheetImageExtension = 'jpeg' | 'png' | 'gif' | 'bmp' | 'tiff' | 'svg' | 'emf' | 'wmf';

export interface SheetImageAnchor {
    /** 0-based, may be fractional (offset within the cell) */
    col: number;
    row: number;
    /** Width and height of a oneCell + ext anchor (pixels, 96 dpi) */
    width?: number;
    height?: number;
    /** Bottom-right corner of a twoCell anchor */
    brCol?: number;
    brRow?: number;
    editAs?: string;
}

export interface SheetImage {
    id: string;
    imageId: number;
    extension: SheetImageExtension;
    base64: string;
    anchor: SheetImageAnchor;
}

export interface SheetBackgroundImage {
    imageId: number;
    extension: SheetImageExtension;
    base64: string;
}

type ImageMedia = ExcelJS.Image;

const KNOWN_EXTENSIONS: SheetImageExtension[] = ['jpeg', 'png', 'gif', 'bmp', 'tiff', 'svg', 'emf', 'wmf'];

/** The image's real type, so that a save doesn't label an emf or a bmp as png. */
function normalizeExtension(ext?: string): SheetImageExtension {
    const lower = (ext || 'png').toLowerCase();
    if (lower === 'jpg' || lower === 'jpeg') return 'jpeg';
    if (lower === 'tif') return 'tiff';
    if (lower === 'svg+xml') return 'svg';
    if (lower === 'x-emf') return 'emf';
    if (lower === 'x-wmf') return 'wmf';
    return (KNOWN_EXTENSIONS as string[]).includes(lower) ? lower as SheetImageExtension : 'png';
}

const DATA_URL_TYPES: Partial<Record<SheetImageExtension, string>> = { svg: 'svg+xml', emf: 'x-emf', wmf: 'x-wmf' };

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function mediaToSheetImageData(media: ImageMedia): { extension: SheetImageExtension; base64: string } | null {
    if (media.base64) {
        const dataUrl = media.base64.match(/^data:image\/(\w+);base64,(.+)$/i);
        if (dataUrl) {
            return {
                extension: normalizeExtension(dataUrl[1]),
                base64: dataUrl[2],
            };
        }
        return {
            extension: normalizeExtension(media.extension),
            base64: media.base64,
        };
    }
    if (media.buffer) {
        const raw = media.buffer as ArrayBuffer | Uint8Array | { buffer: ArrayBuffer };
        const bytes = raw instanceof Uint8Array
            ? raw
            : raw instanceof ArrayBuffer
                ? new Uint8Array(raw)
                : new Uint8Array((raw as { buffer: ArrayBuffer }).buffer);
        return {
            extension: normalizeExtension(media.extension),
            base64: bytesToBase64(bytes),
        };
    }
    return null;
}

function readImageAnchor(range: {
    tl: { col: number; row: number };
    br?: { col: number; row: number };
    ext?: { width: number; height: number };
    editAs?: string;
}): SheetImageAnchor {
    const anchor: SheetImageAnchor = {
        col: range.tl.col,
        row: range.tl.row,
    };
    if (range.ext) {
        anchor.width = range.ext.width;
        anchor.height = range.ext.height;
    }
    if (range.br) {
        anchor.brCol = range.br.col;
        anchor.brRow = range.br.row;
    }
    if (range.editAs) anchor.editAs = range.editAs;
    return anchor;
}

export function readWorksheetImages(
    worksheet: ExcelJS.Worksheet,
    workbook: ExcelJS.Workbook,
): SheetImage[] {
    const items = worksheet.getImages();
    const images: SheetImage[] = [];
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const imageId = Number(item.imageId);
        if (Number.isNaN(imageId)) continue;
        const media = workbook.getImage(imageId);
        const payload = mediaToSheetImageData(media);
        if (!payload) continue;
        const range = item.range;
        if (!range?.tl) continue;
        images.push({
            id: `img_${i}`,
            imageId,
            extension: payload.extension,
            base64: payload.base64,
            anchor: readImageAnchor(range),
        });
    }
    return images;
}

export function readWorksheetBackgroundImage(
    worksheet: ExcelJS.Worksheet,
    workbook: ExcelJS.Workbook,
): SheetBackgroundImage | undefined {
    const bgId = worksheet.getBackgroundImageId();
    if (bgId == null || bgId === '') return undefined;
    const imageId = Number(bgId);
    if (Number.isNaN(imageId)) return undefined;
    const media = workbook.getImage(imageId);
    const payload = mediaToSheetImageData(media);
    if (!payload) return undefined;
    return {
        imageId,
        extension: payload.extension,
        base64: payload.base64,
    };
}

export function buildExcelJsImageRange(anchor: SheetImageAnchor) {
    if (anchor.width != null && anchor.height != null) {
        return {
            tl: { col: anchor.col, row: anchor.row },
            ext: { width: anchor.width, height: anchor.height },
            ...(anchor.editAs ? { editAs: anchor.editAs } : {}),
        };
    }
    if (anchor.brCol != null && anchor.brRow != null) {
        return {
            tl: { col: anchor.col, row: anchor.row },
            br: { col: anchor.brCol, row: anchor.brRow },
            ...(anchor.editAs ? { editAs: anchor.editAs } : {}),
        };
    }
    return {
        tl: { col: anchor.col, row: anchor.row },
        ext: { width: anchor.width ?? 64, height: anchor.height ?? 64 },
        ...(anchor.editAs ? { editAs: anchor.editAs } : {}),
    };
}

export function writeWorksheetImages(
    worksheet: ExcelJS.Worksheet,
    workbook: ExcelJS.Workbook,
    images?: SheetImage[],
    backgroundImage?: SheetBackgroundImage,
) {
    if (backgroundImage) {
        const bgBuffer = base64ToBytes(backgroundImage.base64);
        const bgId = workbook.addImage({
            buffer: bgBuffer as unknown as ExcelJS.Image["buffer"],
            // ExcelJS types only list jpeg, png and gif, but it writes any media type
            extension: backgroundImage.extension as 'png',
        });
        worksheet.addBackgroundImage(bgId);
    }
    if (!images?.length) return;
    for (let i = 0; i < images.length; i += 1) {
        const img = images[i];
        const buffer = base64ToBytes(img.base64);
        const imageId = workbook.addImage({
            buffer: buffer as unknown as ExcelJS.Image["buffer"],
            extension: img.extension as 'png',
        });
        worksheet.addImage(imageId, buildExcelJsImageRange(img.anchor) as Parameters<ExcelJS.Worksheet['addImage']>[1]);
    }
}

export function sheetImageDataUrl(image: Pick<SheetImage, 'extension' | 'base64'>): string {
    return `data:image/${DATA_URL_TYPES[image.extension] ?? image.extension};base64,${image.base64}`;
}
