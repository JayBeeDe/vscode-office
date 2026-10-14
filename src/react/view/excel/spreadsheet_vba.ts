import JSZip from 'jszip';

const VBA_REL_TYPE = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';
const WORKBOOK_PATH = 'xl/workbook.xml';
const WORKBOOK_RELS_PATH = 'xl/_rels/workbook.xml.rels';

/** 原 xlsm 中保存时需原样带回的宏部件；ExcelJS 重建工作簿时会全部丢失 */
export interface VbaParts {
    vbaPath: string;
    files: Record<string, Uint8Array>;
    /** [Content_Types].xml 中与上述部件相关的 Default / Override 条目 */
    contentTypes: string[];
    /** VBA 文档模块 (ThisWorkbook / Sheet1…) 依靠 codeName 与工作簿、工作表关联 */
    workbookCodeName?: string;
}

const readAttr = (element: string, name: string) => element.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

const decodeXml = (text: string) => text
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const encodeXml = (text: string) => text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const relationships = (xml: string) => xml.match(/<Relationship\b[^>]*>/g) ?? [];

/** 将关系目标解析为包内路径：以 / 开头为绝对路径，否则相对于源部件所在目录 */
const resolvePart = (baseDir: string, target: string) => target.startsWith('/') ? target.slice(1) : baseDir + target;

async function openPackage(buffer: ArrayBuffer) {
    try {
        return await JSZip.loadAsync(buffer);
    } catch {
        return null;
    }
}

/**
 * 工作表名称 → codeName。加载时读取并随工作表数据保存，
 * 这样重命名、调整顺序后保存仍能对应到原来的 VBA 工作表模块
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

/** 在已有元素上设置 codeName，元素不存在时在 insertAt 返回的位置插入 */
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

/** sheetCodeNames 为写出顺序，对应 xl/worksheets/sheet{n}.xml */
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
    // codeName 必须唯一，重复的 (例如复制而来的工作表) 留空，由 Excel 重新分配
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
        // sheetPr 必须是 worksheet 的第一个子元素
        zip.file(path, withCodeName(sheetXml, 'sheetPr', codeName, xml => {
            const open = xml.match(/<worksheet\b[^>]*>/);
            return open?.index === undefined ? -1 : open.index + open[0].length;
        }));
    }
}
