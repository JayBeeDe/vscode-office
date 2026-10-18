import { shownMermaidTheme } from "../ui/setMermaidTheme";
import { codicon } from "../util/codicon";
import { svgAsPngUri } from "save-svg-as-png";
import { showToast } from "../ui/toast";

const MERMAID_HOST_CLASS = "vditor-mermaid-host";
const MERMAID_CHROME_CLASS = "vditor-mermaid-chrome";

const chromeMap = new WeakMap<HTMLElement, HTMLElement>();

const createMermaidChrome = () => {
    const chromeRoot = document.createElement("div");
    chromeRoot.className = MERMAID_CHROME_CLASS;

    const toolbar = document.createElement("div");
    toolbar.className = "vditor-mermaid-chrome__toolbar";

    const spacer = document.createElement("div");
    spacer.className = "vditor-mermaid-chrome__spacer";
    toolbar.appendChild(spacer);

    const actions = document.createElement("div");
    actions.className = "vditor-mermaid-chrome__actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "vditor-mermaid-chrome__copy-btn";
    copyBtn.setAttribute("aria-label", "Copy as image");
    copyBtn.innerHTML = `<span class="vditor-mermaid-chrome__copy-icon">${codicon("copy")}</span>`;
    actions.appendChild(copyBtn);

    toolbar.appendChild(actions);
    chromeRoot.appendChild(toolbar);

    return { chromeRoot, copyBtn };
};

export const ensureMermaidHost = (mermaidElement: HTMLElement) => {
    const parent = mermaidElement.parentElement;
    if (parent?.classList.contains(MERMAID_HOST_CLASS)) {
        return parent;
    }

    const host = document.createElement("div");
    host.className = MERMAID_HOST_CLASS;
    if (parent) {
        parent.insertBefore(host, mermaidElement);
        host.appendChild(mermaidElement);
    }
    return host;
};

export const ensureMermaidChrome = (vditor: IVditor, mermaidElement: HTMLElement) => {
    const host = ensureMermaidHost(mermaidElement);
    host.setAttribute("data-mermaid-theme", shownMermaidTheme(vditor));
    if (chromeMap.has(host)) {
        return;
    }

    const created = createMermaidChrome();
    chromeMap.set(host, created.chromeRoot);
    host.insertBefore(created.chromeRoot, host.firstChild);

    created.copyBtn.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    created.copyBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const svg = host.querySelector("svg");
        if (!svg) return;
        try {
            const scale = window.devicePixelRatio || 1;
            const uri = await svgAsPngUri(svg, { scale });
            const res = await fetch(uri);
            const blob = await res.blob();
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            const icon = created.copyBtn.querySelector(".codicon");
            if (icon) {
                icon.className = "codicon codicon-check";
                setTimeout(() => { icon.className = "codicon codicon-copy"; }, 1500);
            }
        } catch (error) {
            showToast(vditor, window.VditorI18n.copyFailed, 1000, "error");
        }
    });
};

export const removeMermaidChrome = (host: HTMLElement) => {
    const chromeRoot = chromeMap.get(host);
    if (!chromeRoot) {
        return;
    }
    chromeRoot.remove();
    chromeMap.delete(host);
};

export const isInsideMermaidChrome = (target: EventTarget | Node | null) => {
    if (!target) {
        return false;
    }
    const node = target instanceof Element ? target : (target as Node).parentElement;
    return !!node?.closest(`.${MERMAID_CHROME_CLASS}`);
};
