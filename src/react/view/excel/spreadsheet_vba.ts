import JSZip from 'jszip';

const VBA_REL_TYPE = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';
const WORKBOOK_PATH = 'xl/workbook.xml';
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';

/** Macro parts of the original xlsm that must be carried back unchanged on save; ExcelJS drops them all when rebuilding the workbook */
export interface VbaParts {
    vbaPath: string;
    files: Record<string, Uint8Array>;
    /** Default / Override entries in [Content_Types].xml related to the parts above */
    contentTypes: string[];
    /** VBA document modules (ThisWorkbook / Sheet1…) are linked to the workbook and worksheets through codeName */
    workbookCodeName?: string;
}

const readAttr = (element: string, name: string) => element.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

const decodeXml = (text: string) => text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const encodeXml = (text: string) => text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const relationships = (xml: string) => xml.match(/<Relationship\b[^>]*>/g) ?? [];

/** Resolve a relationship target to a package path: absolute if it starts with /, otherwise relative to the source part's directory */
const resolvePart = (baseDir: string, target: string) => target.startsWith('/') ? target.slice(1) : baseDir + target;

async function openPackage(buffer: ArrayBuffer) {
    try {
        return await JSZip.loadAsync(buffer);
    } catch {
        return null;
    }
}

/**
 * Worksheet name → codeName. Read on load and kept with the worksheet data,
 * so that after renaming or reordering, saving still maps to the original VBA worksheet modules
 */
export async function readSheetCodeNames(buffer: ArrayBuffer): Promise<Record<string, string>> {
    const zip = await openPackage(buffer);
    const workbookRels = await zip?.file(WORKBOOK_RELS_PATH)?.async('string');
    const workbookXml = await zip?.file(WORKBOOK_PATH)?.async('string');
    const codeNames: Record<string, string> = {};
    if (!zip || !workbookRels || !workbookXml) {
        return codeNames;
    }
    for (const sheet of workbookXml.match(/<sheet\b[^>]*>/g) ?? []) {
        const name = readAttr(sheet, 'name');
        const relId = readAttr(sheet, 'r:id');
        const rel = relationships(workbookRels).find(r => readAttr(r, 'Id') === relId);
        const target = rel && readAttr(rel, 'Target');
        if (!name || !target) continue;
        const sheetXml = await zip.file(resolvePart('xl/', target))?.async('string');
        const sheetPr = sheetXml?.match(/<sheetPr\b[^>]*>/)?.[0];
        const codeName = sheetPr && readAttr(sheetPr, 'codeName');
        if (codeName) {
            codeNames[decodeXml(name)] = decodeXml(codeName);
        }
    }
    return codeNames;
}

export async function extractVbaParts(buffer: ArrayBuffer): Promise<VbaParts | null> {
    const zip = await openPackage(buffer);
    if (!zip) {
        return null;
    }
    const workbookRels = await zip.file(WORKBOOK_RELS_PATH)?.async('string');
    const vbaRel = workbookRels && relationships(workbookRels).find(rel => readAttr(rel, 'Type') === VBA_REL_TYPE);
    const vbaTarget = vbaRel && readAttr(vbaRel, 'Target');
    if (!workbookRels || !vbaTarget) {
        return null;
    }

    const vbaPath = resolvePart('xl/', vbaTarget);
    const vbaDir = vbaPath.slice(0, vbaPath.lastIndexOf('/') + 1);
    const vbaRelsPath = `${vbaDir}_rels/${vbaPath.slice(vbaDir.length)}.rels`;
    const paths = [vbaPath];
    const vbaRels = await zip.file(vbaRelsPath)?.async('string');
    if (vbaRels) {
        paths.push(vbaRelsPath);
        for (const rel of relationships(vbaRels)) {
            const target = readAttr(rel, 'Target');
            if (target && readAttr(rel, 'TargetMode') !== 'External') {
                paths.push(resolvePart(vbaDir, target));
            }
        }
    }
    const files: Record<string, Uint8Array> = {};
    for (const path of paths) {
        const file = zip.file(path);
        if (file) {
            files[path] = await file.async('uint8array');
        }
    }
    if (!files[vbaPath]) {
        return null;
    }

    const contentTypesXml = await zip.file('[Content_Types].xml')?.async('string') ?? '';
    const extensions = new Set(Object.keys(files).map(path => path.slice(path.lastIndexOf('.') + 1).toLowerCase()));
    const contentTypes = (contentTypesXml.match(/<(?:Default|Override)\b[^>]*>/g) ?? []).filter(entry => {
        const partName = readAttr(entry, 'PartName');
        if (partName) {
            return files[partName.replace(/^\//, '')] !== undefined;
        }
        const extension = readAttr(entry, 'Extension')?.toLowerCase();
        return !!extension && extensions.has(extension) && extension !== 'rels' && extension !== 'xml';
    });

    const workbookXml = await zip.file(WORKBOOK_PATH)?.async('string') ?? '';
    const workbookPr = workbookXml.match(/<workbookPr\b[^>]*>/)?.[0];
    const workbookCodeName = workbookPr && readAttr(workbookPr, 'codeName');

    return { vbaPath, files, contentTypes, workbookCodeName: workbookCodeName ? decodeXml(workbookCodeName) : undefined };
}

/** Set codeName on the existing element; if the element is missing, insert it at the position returned by insertAt */
function withCodeName(xml: string, tag: string, codeName: string, insertAt: (xml: string) => number) {
    const value = encodeXml(codeName);
    const element = xml.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0];
    if (element) {
        const updated = /\bcodeName="/.test(element)
            ? element.replace(/\bcodeName="[^"]*"/, `codeName="${value}"`)
            : element.replace(`<${tag}`, `<${tag} codeName="${value}"`);
        return xml.replace(element, updated);
    }
    const index = insertAt(xml);
    return index < 0 ? xml : `${xml.slice(0, index)}<${tag} codeName="${value}"/>${xml.slice(index)}`;
}

/** sheetCodeNames is in write order, matching xl/worksheets/sheet{n}.xml */
export async function injectVbaParts(zip: JSZip, parts: VbaParts, sheetCodeNames: (string | undefined)[]) {
    for (const [path, data] of Object.entries(parts.files)) {
        zip.file(path, data);
    }

    const workbookRels = await zip.file(WORKBOOK_RELS_PATH)?.async('string');
    if (workbookRels && !workbookRels.includes(VBA_REL_TYPE)) {
        const ids = new Set(relationships(workbookRels).map(rel => readAttr(rel, 'Id')));
        let n = ids.size + 1;
        while (ids.has(`rId${n}`)) n += 1;
        const target = parts.vbaPath.startsWith('xl/') ? parts.vbaPath.slice(3) : `/${parts.vbaPath}`;
        zip.file(WORKBOOK_RELS_PATH, workbookRels.replace(
            '</Relationships>',
            `<Relationship Id="rId${n}" Type="${VBA_REL_TYPE}" Target="${target}"/></Relationships>`,
        ));
    }

    const contentTypesFile = zip.file('[Content_Types].xml');
    if (contentTypesFile) {
        let xml = await contentTypesFile.async('string');
        for (const entry of parts.contentTypes) {
            const partName = readAttr(entry, 'PartName');
            const extension = readAttr(entry, 'Extension');
            const exists = partName ? xml.includes(`PartName="${partName}"`) : xml.includes(`Extension="${extension}"`);
            if (!exists) {
                xml = xml.replace('</Types>', `${entry}</Types>`);
            }
        }
        zip.file('[Content_Types].xml', xml);
    }

    if (parts.workbookCodeName) {
        const workbookXml = await zip.file(WORKBOOK_PATH)?.async('string');
        if (workbookXml) {
            zip.file(WORKBOOK_PATH, withCodeName(workbookXml, 'workbookPr', parts.workbookCodeName,
                xml => xml.search(/<bookViews\b|<sheets\b/)));
        }
    }
    // codeName must be unique; duplicates (e.g. copied worksheets) are left empty for Excel to reassign
    const usedCodeNames = new Set(parts.workbookCodeName ? [parts.workbookCodeName] : []);
    for (let i = 0; i < sheetCodeNames.length; i += 1) {
        const candidate = sheetCodeNames[i];
        const codeName = candidate && !usedCodeNames.has(candidate) ? candidate : undefined;
        if (codeName) {
            usedCodeNames.add(codeName);
        }
        const path = `xl/worksheets/sheet${i + 1}.xml`;
        const sheetXml = codeName ? await zip.file(path)?.async('string') : undefined;
        if (!codeName || !sheetXml) continue;
        // sheetPr must be the first child of worksheet
        zip.file(path, withCodeName(sheetXml, 'sheetPr', codeName, xml => {
            const open = xml.match(/<worksheet\b[^>]*>/);
            return open?.index === undefined ? -1 : open.index + open[0].length;
        }));
    }
}
