import { convertXmindToMindElixir, importXMindFile } from '@mind-elixir/import-xmind';
import JSZip from 'jszip';
import type { MindElixirData, NodeObj } from 'mind-elixir';
import type { Sheet, Topic } from '@mind-elixir/import-xmind';

export interface XmindSheet {
    id: string;
    title: string;
    data: MindElixirData;
}

export interface XmindDocument {
    sheets: XmindSheet[];
    resolveImageUrl: (url: string) => string;
    export: (sheets: XmindSheet[]) => Promise<Uint8Array>;
    dispose: () => void;
}

const XAP_PREFIX = /^xap:(resources|attachments|resource)\//i;
const RESOURCE_DIRS = ['resources/', 'attachments/'];
const DEFAULT_SHEET_ID = 'sheet-1';
const DEFAULT_ROOT_TOPIC_ID = 'root-topic';

type MindArrow = NonNullable<MindElixirData['arrows']>[number];
type MindSummary = NonNullable<MindElixirData['summaries']>[number];

function createEmptyXmindSheet(): Sheet {
    return {
        id: DEFAULT_SHEET_ID,
        title: 'Sheet 1',
        rootTopic: {
            id: DEFAULT_ROOT_TOPIC_ID,
            title: '',
        },
        style: { id: '', type: '', properties: {} },
        topicPositioning: 'balanced',
        topicOverlapping: '',
        theme: { id: '', title: '' },
        relationships: [],
        legend: {
            visibility: 'visible',
            position: { x: 0, y: 0 },
            markers: {},
            groups: {},
        },
        settings: {
            'infoItems/infoItem': [],
            'tab-color': [],
        },
    };
}

function getMimeType(path: string): string {
    const lower = path.toLowerCase();
    if (lower.endsWith('.png')) {
        return 'image/png';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    if (lower.endsWith('.gif')) {
        return 'image/gif';
    }
    if (lower.endsWith('.webp')) {
        return 'image/webp';
    }
    if (lower.endsWith('.svg')) {
        return 'image/svg+xml';
    }
    if (lower.endsWith('.bmp')) {
        return 'image/bmp';
    }
    return 'application/octet-stream';
}

async function buildImageResourceMap(buffer: ArrayBuffer): Promise<{
    map: Map<string, string>;
    reverseMap: Map<string, string>;
    blobUrls: string[];
    zip: JSZip;
}> {
    const zip = await JSZip.loadAsync(buffer);
    const map = new Map<string, string>();
    const reverseMap = new Map<string, string>();
    const blobUrls: string[] = [];

    for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir) {
            continue;
        }
        const normalizedPath = path.replace(/\\/g, '/');
        const lowerPath = normalizedPath.toLowerCase();
        if (!RESOURCE_DIRS.some(dir => lowerPath.startsWith(dir))) {
            continue;
        }

        const mime = getMimeType(normalizedPath);
        const data = await entry.async('uint8array');
        const blob = new Blob([data], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        blobUrls.push(blobUrl);

        const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
        const zipPath = normalizedPath.replace(/^\/+/, '');
        const variants = new Set<string>([
            normalizedPath,
            zipPath,
            fileName,
            `xap:resources/${fileName}`,
            `xap:attachments/${fileName}`,
            `xap:resource/${fileName}`,
            `xap:resources/${zipPath}`,
            `xap:attachments/${zipPath}`,
            `xap:resource/${zipPath}`,
        ]);
        for (const key of variants) {
            map.set(key, blobUrl);
        }
        reverseMap.set(blobUrl, `xap:${zipPath}`);
    }

    return { map, reverseMap, blobUrls, zip };
}

function resolveXapResourceUrl(url: string, map: Map<string, string>): string {
    if (!url || !/^xap:/i.test(url)) {
        return url;
    }
    const direct = map.get(url) ?? map.get(url.toLowerCase());
    if (direct) {
        return direct;
    }

    const withoutScheme = url.replace(/^xap:/i, '');
    const fromScheme = map.get(withoutScheme) ?? map.get(withoutScheme.toLowerCase());
    if (fromScheme) {
        return fromScheme;
    }

    const zipPath = url.replace(XAP_PREFIX, '$1/');
    const fromZipPath = map.get(zipPath) ?? map.get(zipPath.toLowerCase());
    if (fromZipPath) {
        return fromZipPath;
    }

    const fileName = zipPath.split('/').pop();
    if (fileName) {
        const fromName = map.get(fileName) ?? map.get(fileName.toLowerCase());
        if (fromName) {
            return fromName;
        }
    }

    return url;
}

function patchNodeImages(node: NodeObj, resolve: (url: string) => string): void {
    if (node.image?.url) {
        node.image = {
            ...node.image,
            url: resolve(node.image.url),
        };
    }
    if (node.children) {
        for (const child of node.children) {
            patchNodeImages(child, resolve);
        }
    }
}

function cloneNodeWithoutParent(node: NodeObj): NodeObj {
    const { parent: _parent, children, ...rest } = node;
    return {
        ...rest,
        ...(children ? { children: children.map(cloneNodeWithoutParent) } : {}),
    };
}

/** Labels as content.json stores them: an array of strings (an XMind 8 import nests them in an array). */
function normalizeTags(tags: NodeObj['tags']): string[] | undefined {
    if (!tags?.length) {
        return undefined;
    }
    const labels = (tags as unknown[]).flat(2)
        .map(tag => (typeof tag === 'string' ? tag : (tag as { text?: string })?.text))
        .filter((tag): tag is string => !!tag);
    return labels.length ? labels : undefined;
}

/** Every topic of a sheet by id: attached, detached, callout and summary topics. */
function indexTopics(topic: Topic | undefined, map = new Map<string, Topic>()): Map<string, Topic> {
    if (!topic) return map;
    map.set(topic.id, topic);
    const children = topic.children as Record<string, Topic[] | undefined> | undefined;
    for (const list of Object.values(children ?? {})) {
        for (const child of list ?? []) indexTopics(child, map);
    }
    return map;
}

/**
 * The saved topic is the original one with what the viewer edits written over it, so that what
 * it doesn't show (style, markers, boundaries, numbering, structure, position, detached topics,
 * callouts, rich notes, extensions...) is kept.
 */
function mindNodeToXmindTopic(node: NodeObj, restoreImageUrl: (url: string) => string, originals: Map<string, Topic>): Topic {
    const original = originals.get(node.id);
    const { children: originalChildren, ...originalRest } = (original ?? {}) as Topic;
    const topic: Topic = {
        ...originalRest,
        id: node.id,
        title: node.topic ?? 'Untitled',
    };
    if (node.expanded === false) {
        topic.branch = 'folded';
    } else {
        delete topic.branch;
    }
    const labels = normalizeTags(node.tags);
    if (labels) {
        topic.labels = labels as unknown as Topic['labels'];
    } else {
        delete topic.labels;
    }
    if (node.hyperLink) {
        topic.href = node.hyperLink;
    } else {
        delete topic.href;
    }
    const originalNote = original?.notes?.plain?.content;
    if (node.note && node.note !== originalNote) {
        topic.notes = {
            plain: { content: node.note },
            html: { content: { paragraphs: [] } },
        };
    } else if (!node.note) {
        delete topic.notes;
    }
    if (node.image?.url) {
        topic.image = {
            ...(original?.image ?? {}),
            src: restoreImageUrl(node.image.url),
            width: node.image.width,
            height: node.image.height,
            align: original?.image?.align ?? 'center',
        };
    } else {
        delete topic.image;
    }
    // detached topics, callouts... are not shown: keep them; attached ones are the edited children
    const children: Record<string, unknown> = { ...(originalChildren ?? {}) };
    delete children.attached;
    delete children.summary;
    if (node.children?.length) {
        children.attached = node.children.map(child => mindNodeToXmindTopic(child, restoreImageUrl, originals));
    }
    if (Object.keys(children).length) {
        topic.children = children as Topic['children'];
    } else {
        delete topic.children;
    }
    delete topic.summaries;
    return topic;
}

function mindArrowsToXmindRelationships(arrows: MindArrow[] | undefined, original: Sheet['relationships'] = []) {
    if (!arrows?.length) {
        return [];
    }
    const originalById = new Map((original ?? []).map(relationship => [relationship.id, relationship]));
    return arrows.map(arrow => {
        const source = originalById.get(arrow.id);
        const title = arrow.label || '';
        return {
            style: { id: '', type: '', properties: {} },
            class: '',
            ...(source ?? {}),
            id: arrow.id,
            title,
            end1Id: arrow.from,
            end2Id: arrow.to,
            controlPoints: {
                0: arrow.delta1 ?? { x: 50, y: 50 },
                1: arrow.delta2 ?? { x: 50, y: 50 },
            },
        };
    });
}

function collectSummaryTopics(topic: Topic, summaries: MindSummary[] | undefined, originals: Map<string, Topic>): void {
    if (!summaries?.length) {
        return;
    }
    const topicSummaries = summaries.filter(summary => summary.parent === topic.id);
    if (topicSummaries.length) {
        const originalSummaries = originals.get(topic.id)?.summaries ?? [];
        topic.summaries = topicSummaries.map(summary => {
            const source = originalSummaries.find(item => item.id === summary.id);
            // the original summary topic (title, style, children) when it still exists
            const originalTopic = source?.topicId ? originals.get(source.topicId) : undefined;
            const topicId = originalTopic?.id ?? `${summary.id}-topic`;
            const summaryTopic: Topic = {
                ...(originalTopic ?? {}),
                id: topicId,
                title: summary.label || originalTopic?.title || 'summary',
            };
            topic.children = topic.children ?? {};
            topic.children.summary = [...(topic.children.summary ?? []), summaryTopic];
            return {
                style: { id: '', type: '', properties: {} },
                class: '',
                ...(source ?? {}),
                id: summary.id,
                range: `(${summary.start},${summary.end})`,
                topicId,
            };
        });
    }
    topic.children?.attached?.forEach(child => collectSummaryTopics(child, summaries, originals));
}

function mindDataToXmindSheet(original: Sheet, sheet: XmindSheet, restoreImageUrl: (url: string) => string): Sheet {
    const data = {
        ...sheet.data,
        nodeData: cloneNodeWithoutParent(sheet.data.nodeData),
    };
    const originals = indexTopics(original.rootTopic);
    const rootTopic = mindNodeToXmindTopic(data.nodeData, restoreImageUrl, originals);
    collectSummaryTopics(rootTopic, data.summaries, originals);
    // an XMind 8 sheet names its theme by a style id: content.json expects a theme object
    const theme = typeof (original.theme as unknown) === 'string'
        ? { id: original.theme as unknown as string, title: '' }
        : original.theme;
    return {
        ...original,
        theme,
        id: sheet.id,
        title: sheet.title || data.nodeData.topic || original.title || 'Sheet',
        rootTopic,
        relationships: mindArrowsToXmindRelationships(data.arrows, original.relationships),
        topicPositioning: data.direction === 2 ? (original.topicPositioning || 'balanced') : original.topicPositioning,
    };
}

/** Parts of the XMind 8 format, which content.json replaces: left in the file they would be stale. */
const LEGACY_PARTS = /^(content\.xml|meta\.xml|styles\.xml|comments\.xml|META-INF\/|Revisions\/|Thumbnails\/)/;

async function readJson(zip: JSZip, path: string): Promise<Record<string, any> | null> {
    try {
        const text = await zip.file(path)?.async('string');
        return text ? JSON.parse(text) : null;
    } catch {
        return null;
    }
}

/**
 * Write the sheets as an XMind (Zen) package: content.json, with the existing metadata and a
 * manifest listing every part, resources included. An XMind 8 file is converted, so that no
 * outdated content.xml is left for its readers.
 */
async function writeZenPackage(zip: JSZip, content: Sheet[]) {
    for (const path of Object.keys(zip.files)) {
        if (LEGACY_PARTS.test(path)) zip.remove(path);
    }
    zip.file('content.json', JSON.stringify(content));

    const metadata = (await readJson(zip, 'metadata.json')) ?? { creator: { name: 'Office Viewer' } };
    if (metadata.activeSheetId && !content.some(sheet => sheet.id === metadata.activeSheetId)) {
        metadata.activeSheetId = content[0]?.id;
    }
    zip.file('metadata.json', JSON.stringify(metadata));

    const manifest = (await readJson(zip, 'manifest.json')) ?? {};
    const entries: Record<string, unknown> = {};
    for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path === 'manifest.json') continue;
        entries[path] = manifest['file-entries']?.[path] ?? {};
    }
    entries['manifest.json'] = manifest['file-entries']?.['manifest.json'] ?? {};
    zip.file('manifest.json', JSON.stringify({ ...manifest, 'file-entries': entries }));
}

function createXmindDocument(
    sourceSheets: Sheet[],
    zip: JSZip,
    map: Map<string, string>,
    reverseMap: Map<string, string>,
    blobUrls: string[],
): XmindDocument {
    const result: XmindSheet[] = [];
    const resolveImageUrl = (url: string) => resolveXapResourceUrl(url, map);
    const restoreImageUrl = (url: string) => reverseMap.get(url) ?? url;
    for (const sheet of sourceSheets) {
        const data = convertXmindToMindElixir(sheet);
        patchNodeImages(data.nodeData, resolveImageUrl);
        result.push({
            id: sheet.id,
            title: sheet.title || 'Untitled',
            data,
        });
    }

    return {
        sheets: result,
        resolveImageUrl,
        export: async (nextSheets: XmindSheet[]) => {
            const sourceById = new Map(sourceSheets.map(sheet => [sheet.id, sheet]));
            const content = nextSheets.map(sheet => {
                const source = sourceById.get(sheet.id) ?? sourceSheets[0];
                return mindDataToXmindSheet(source, sheet, restoreImageUrl);
            });
            await writeZenPackage(zip, content);
            return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        },
        dispose: () => {
            for (const url of blobUrls) {
                URL.revokeObjectURL(url);
            }
            map.clear();
            reverseMap.clear();
        },
    };
}

/**
 * The import parses XMind 8 XML with number conversion: a title "1.10" becomes 1.1 and "007"
 * becomes 7. Put back the exact text from content.xml, and make every title a string.
 */
async function restoreXmind8Titles(zip: JSZip, sheets: Sheet[]) {
    const titles = new Map<string, string>();
    const xml = zip.file('content.json') ? undefined : await zip.file('content.xml')?.async('string');
    if (xml && typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        for (const element of Array.from(doc.getElementsByTagName('*'))) {
            if (element.localName !== 'topic' && element.localName !== 'sheet') continue;
            const id = element.getAttribute('id');
            const title = Array.from(element.children).find(child => child.localName === 'title');
            if (id && title) titles.set(id, title.textContent ?? '');
        }
    }
    const fix = (item: { id: string; title?: unknown }) => {
        const exact = titles.get(item.id);
        if (exact !== undefined) item.title = exact;
        else if (item.title != null && typeof item.title !== 'string') item.title = String(item.title);
    };
    for (const sheet of sheets) {
        fix(sheet as { id: string; title?: unknown });
        for (const topic of indexTopics(sheet.rootTopic).values()) fix(topic as { id: string; title?: unknown });
    }
}

export async function parseXmind(buffer: ArrayBuffer, fileName = 'document.xmind'): Promise<XmindDocument> {
    if (buffer.byteLength === 0) {
        return createXmindDocument(
            [createEmptyXmindSheet()],
            new JSZip(),
            new Map<string, string>(),
            new Map<string, string>(),
            [],
        );
    }

    const { map, reverseMap, blobUrls, zip } = await buildImageResourceMap(buffer);
    const file = new File([buffer], fileName, { type: 'application/vnd.xmind.workbook' });
    const sourceSheets = await importXMindFile(file);
    await restoreXmind8Titles(zip, sourceSheets);
    return createXmindDocument(sourceSheets, zip, map, reverseMap, blobUrls);
}
