import {Constants} from "../constants";
import {processAfterRender} from "../ir/process";
import {getMarkdown} from "../markdown/getMarkdown";
import {mathRender} from "../markdown/mathRender";
import {restoreCacheFocus, wasCacheContentRestored} from "../util/cacheFocus";
import {getEventName, updateHotkeyTip} from "../util/compatibility";
import {highlightToolbar} from "../util/highlightToolbar";
import {log} from "../util/log";
import {processCodeRender} from "../util/processCode";
import {renderTocNow} from "../util/toc";
import {ensureEditorBoundaryParagraphs, renderDomByMd} from "../wysiwyg/renderDomByMd";
import {renderCodeBlocks} from "../codeBlock/codeMirrorManager";
import {MenuItem} from "./MenuItem";
import {
    disableToolbar,
    enableToolbar,
    hidePanel,
    removeCurrentToolbar,
    showToolbar,
} from "./setToolbar";

type SetEditModeOptions = {
    keepToolbarPanel?: boolean;
};

const EDIT_MODE_TARGETS: { [mode: string]: { labelKey: string, descKey: string, hotkey: string } } = {
    ir: {labelKey: "instantRendering", descKey: "edit-mode-ir-desc", hotkey: "⌥⌘8"},
    wysiwyg: {labelKey: "wysiwyg", descKey: "edit-mode-wysiwyg-desc", hotkey: "⌥⌘7"},
};

/**
 * The toolbar's edit mode button toggles WYSIWYG / instant rendering: highlighted in instant
 * rendering (the Markdown syntax shows), its tooltip names the mode a click switches to.
 */
const refreshEditModeButton = (vditor: IVditor) => {
    const button = vditor.toolbar.elements["edit-mode"]?.querySelector("button");
    if (!button) {
        return;
    }
    const target = EDIT_MODE_TARGETS[vditor.currentMode === "ir" ? "wysiwyg" : "ir"];
    const label = window.VditorI18n[target.labelKey] || target.labelKey;
    const desc = window.VditorI18n[target.descKey];
    button.setAttribute("aria-label",
        `${label}${desc ? `: ${desc}` : ""} <${updateHotkeyTip(target.hotkey)}>`);
    button.classList.toggle("vditor-menu--current", vditor.currentMode === "ir");
};

export const setEditMode = (
    vditor: IVditor,
    type: string,
    event: Event | string,
    options?: SetEditModeOptions,
) => {
    let markdownText;
    if (typeof event !== "string") {
        if (!options?.keepToolbarPanel) {
            hidePanel(vditor, ["subToolbar", "hint"]);
        }
        event.preventDefault();
        markdownText = getMarkdown(vditor);
    } else {
        markdownText = event;
    }
    if (vditor.currentMode === type && typeof event !== "string") {
        return;
    }

    enableToolbar(vditor.toolbar.elements, Constants.EDIT_TOOLBARS);
    removeCurrentToolbar(vditor.toolbar.elements, Constants.EDIT_TOOLBARS);
    disableToolbar(vditor.toolbar.elements, ["outdent", "indent"]);

    if (type === "ir") {
        showToolbar(vditor.toolbar.elements, ["outdent", "indent", "outline", "insert-before", "insert-after"]);
        vditor.wysiwyg.element.parentElement.style.display = "none";
        vditor.ir.element.parentElement.style.display = "block";

        vditor.lute.SetVditorIR(true);
        vditor.lute.SetVditorWYSIWYG(false);

        vditor.currentMode = "ir";
        const irHTML = vditor.lute.Md2VditorIRDOM(markdownText);
        log("Md2VditorIRDOM", irHTML, "result", vditor.options.debugger);
        vditor.ir.element.innerHTML = irHTML;
        processAfterRender(vditor, {
            enableAddUndoStack: true,
            enableHint: false,
            enableInput: false,
        });

        vditor.ir.element.querySelectorAll(".vditor-ir__preview[data-render='2']").forEach((item: HTMLElement) => {
            processCodeRender(item, vditor);
        });
        renderCodeBlocks(vditor);
        ensureEditorBoundaryParagraphs(vditor.ir.element);
        vditor.ir.element.querySelectorAll(".vditor-toc").forEach((item: HTMLElement) => {
            mathRender(item, {
                cdn: vditor.options.cdn,
                math: vditor.options.preview.math,
            });
        });
        vditor.ir.popover.style.display = "none";
    } else if (type === "wysiwyg") {
        showToolbar(vditor.toolbar.elements, ["outdent", "indent", "outline", "insert-before", "insert-after"]);
        vditor.wysiwyg.element.parentElement.style.display = "block";
        vditor.ir.element.parentElement.style.display = "none";

        vditor.lute.SetVditorIR(false);
        vditor.lute.SetVditorWYSIWYG(true);

        vditor.currentMode = "wysiwyg";

        renderDomByMd(vditor, markdownText, {
            enableAddUndoStack: true,
            enableHint: false,
            enableInput: false,
        });
        vditor.wysiwyg.element.querySelectorAll(".vditor-toc").forEach((item: HTMLElement) => {
            mathRender(item, {
                cdn: vditor.options.cdn,
                math: vditor.options.preview.math,
            });
        });
        vditor.wysiwyg.popover.style.display = "none";
    }
    vditor.undo.resetIcon(vditor);
    if (typeof event !== "string") {
        // do not focus on init
        vditor[vditor.currentMode].element.focus();
        highlightToolbar(vditor);
    } else if (wasCacheContentRestored(vditor)) {
        restoreCacheFocus(vditor, { onLoad: true });
    }
    renderTocNow(vditor);

    refreshEditModeButton(vditor);

    vditor.outline.toggle(vditor, vditor.options.outline.enable);

    if (typeof event !== "string") {
        if (vditor.options.changeEditMode) {
            vditor.options.changeEditMode(vditor.currentMode);
        }
    }
};

export class EditMode extends MenuItem {
    public element: HTMLElement;

    constructor(vditor: IVditor, menuItem: IMenuItem) {
        super(vditor, menuItem);
        this.element.children[0].addEventListener(getEventName(), (event) => {
            event.preventDefault();
            if (this.element.firstElementChild.classList.contains(Constants.CLASS_MENU_DISABLED)) {
                return;
            }
            setEditMode(vditor, vditor.currentMode === "ir" ? "wysiwyg" : "ir", event);
        });
    }
}
