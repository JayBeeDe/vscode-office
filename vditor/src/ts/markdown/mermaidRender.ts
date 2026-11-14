import {Constants} from "../constants";
import {addScript} from "../util/addScript";
import {MERMAID_THEME_ATTR} from "../ui/mermaidThemeCatalog";
import {shownMermaidTheme} from "../ui/setMermaidTheme";
import {mermaidRenderAdapter} from "./adapterRender";
import {ensureMermaidChrome} from "./mermaidChrome";
import {buildMermaidInitConfig, findVditorRoot} from "./mermaidTheme";

declare const mermaid: {
    initialize(options: unknown): void,
    render(
        id: string,
        code: string,
        container?: Element,
    ): Promise<{ svg: string; bindFunctions?: (element: Element) => void }>,
};

const MERMAID_PROCESSED_ATTR = "data-vditor-mermaid-processed";
const MERMAID_SOURCE_ATTR = "data-mermaid";

const MERMAID_BASE_CONFIG = {
    altFontFamily: "sans-serif",
    flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
    },
    fontFamily: "sans-serif",
    gantt: {
        leftPadding: 75,
        rightPadding: 20,
    },
    securityLevel: "strict",
    sequence: {
        boxMargin: 8,
        diagramMarginX: 8,
        diagramMarginY: 8,
        useMaxWidth: true,
    },
    startOnLoad: false,
};

let renderCounter = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

const storeMermaidSource = (item: Element, code: string) => {
    if (!item.getAttribute(MERMAID_SOURCE_ATTR) && code.trim()) {
        item.setAttribute(MERMAID_SOURCE_ATTR, code);
    }
};

const getMermaidSource = (item: Element) => {
    return item.getAttribute(MERMAID_SOURCE_ATTR) || mermaidRenderAdapter.getCode(item);
};

const clearMermaidElement = (item: HTMLElement) => {
    item.removeAttribute("data-processed");
    item.removeAttribute(MERMAID_PROCESSED_ATTR);
    item.removeAttribute("id");
    item.classList.remove("vditor-reset--error");
    const source = item.getAttribute(MERMAID_SOURCE_ATTR);
    if (source) {
        item.textContent = source;
        return;
    }
    item.innerHTML = "";
};

/**
 * Where mermaid lays out a diagram before it is shown: a box off screen, out of the document's flow
 * and contained (its layout and style do not reach the rest of the page), with the diagram's font
 * and width so the text measures as it will be shown. Laid out in the diagram itself, inside the
 * editor, each of mermaid's many text measurements laid the whole document out again: a diagram
 * took over a second there, and the page could not scroll meanwhile (a tenth of that in this box).
 */
let renderHost: HTMLElement | undefined;
const getRenderHost = (item: HTMLElement) => {
    if (!renderHost || !renderHost.isConnected) {
        renderHost = document.createElement("div");
        renderHost.className = "vditor-mermaid-render-host";
        renderHost.setAttribute("aria-hidden", "true");
        renderHost.style.cssText = "position:fixed;left:-100000px;top:0;height:0;overflow:hidden;"
            + "contain:strict;visibility:hidden;pointer-events:none;";
        document.body.appendChild(renderHost);
    }
    const style = getComputedStyle(item);
    renderHost.style.width = `${item.clientWidth || 800}px`;
    renderHost.style.fontFamily = style.fontFamily;
    renderHost.style.fontSize = style.fontSize;
    renderHost.style.lineHeight = style.lineHeight;
    renderHost.style.color = style.color;
    return renderHost;
};

const renderSingleMermaid = async (item: HTMLElement, code: string, index: number) => {
    // read before the source replaces its content (the spinner's box)
    const host = getRenderHost(item);
    clearMermaidElement(item);
    const renderId = `vditor-mermaid-${++renderCounter}-${Date.now()}-${index}`;
    try {
        const {svg, bindFunctions} = await mermaid.render(renderId, code, host);
        item.innerHTML = svg;
        bindFunctions?.(item);
        item.setAttribute(MERMAID_PROCESSED_ATTR, "true");
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        item.className = "language-mermaid vditor-reset--error";
        item.textContent = `${window.VditorI18n.mermaidRenderError}: ${message}`;
        item.setAttribute(MERMAID_PROCESSED_ATTR, "true");
    } finally {
        // what a failed render leaves behind
        host.replaceChildren();
    }
};

/**
 * Diagrams are drawn one at a time, the page handling what is waiting (typing, clicks, painting)
 * before each: every block renders its own (processCodeRender), all at once, and mermaid chains them
 * on promises that let nothing else run, so a document with many froze until the last. A timer, not
 * scheduler.yield(), whose continuation goes before the other tasks.
 */
let renderQueue: Promise<void> = Promise.resolve();
const queueRender = (task: () => Promise<void>) => {
    const run = renderQueue.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0))).then(task);
    renderQueue = run.catch(() => undefined);
    return run;
};

const getThemeId = (themeRoot: HTMLElement, vditor?: IVditor) => {
    if (vditor) {
        return shownMermaidTheme(vditor);
    }
    return themeRoot.getAttribute(MERMAID_THEME_ATTR) || "light";
};

const renderMermaidElements = async (
    mermaidElements: NodeListOf<Element>,
    themeRoot: HTMLElement,
    vditor?: IVditor,
) => {
    const themeId = getThemeId(themeRoot, vditor);
    const themeConfig = buildMermaidInitConfig(themeId);
    mermaid.initialize({...MERMAID_BASE_CONFIG, ...themeConfig});
    for (let i = 0; i < mermaidElements.length; i++) {
        const item = mermaidElements[i] as HTMLElement;
        if (item.getAttribute(MERMAID_PROCESSED_ATTR) === "true") {
            continue;
        }
        const code = getMermaidSource(item).trim();
        if (!code) {
            // nothing to draw: done, or the loading spinner would stay
            item.setAttribute(MERMAID_PROCESSED_ATTR, "true");
            continue;
        }
        storeMermaidSource(item, code);
        await queueRender(async () => {
            await renderSingleMermaid(item, code, i);
            if (vditor) {
                ensureMermaidChrome(vditor, item);
            }
        });
    }
};

const doRefreshMermaidTheme = (root: HTMLElement, cdn: string, vditor?: IVditor) => {
    const mermaidElements = root.querySelectorAll(`.language-mermaid[${MERMAID_PROCESSED_ATTR}='true']`);
    if (mermaidElements.length === 0) {
        return;
    }
    for (let i = 0; i < mermaidElements.length; i++) {
        clearMermaidElement(mermaidElements[i] as HTMLElement);
    }
    addScript(`${cdn}/dist/js/mermaid/mermaid.min.js`, "vditorMermaidScript").then(() => {
        renderMermaidElements(mermaidElements, root, vditor);
    });
};

export const mermaidRender = (
    element: HTMLElement,
    cdn = Constants.CDN,
    vditorOrThemeRoot?: IVditor | HTMLElement,
) => {
    const mermaidElements = mermaidRenderAdapter.getElements(element);
    if (mermaidElements.length === 0) {
        return;
    }
    let themeRoot: HTMLElement;
    let vditor: IVditor | undefined;
    if (vditorOrThemeRoot && "options" in vditorOrThemeRoot) {
        vditor = vditorOrThemeRoot;
        themeRoot = vditor.element;
    } else {
        themeRoot = (vditorOrThemeRoot as HTMLElement | undefined) ?? findVditorRoot(element);
    }
    addScript(`${cdn}/dist/js/mermaid/mermaid.min.js`, "vditorMermaidScript").then(() => {
        renderMermaidElements(mermaidElements, themeRoot, vditor);
    });
};

export const refreshMermaidTheme = (root: HTMLElement, cdn = Constants.CDN, vditor?: IVditor) => {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        doRefreshMermaidTheme(root, cdn, vditor);
    }, 50);
};
