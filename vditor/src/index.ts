import "./assets/less/index.less";
import * as adapterRender from "./ts/markdown/adapterRender";
import { codeRender } from "./ts/markdown/codeRender";
import { codeMirrorPreviewRender } from "./ts/codeBlock/codeMirrorPreviewRender";
import { renderCodeBlocks } from "./ts/codeBlock/codeMirrorManager";
import { mathRender } from "./ts/markdown/mathRender";
import { mermaidRender } from "./ts/markdown/mermaidRender";
import { outlineRender } from "./ts/markdown/outlineRender";
import { plantumlRender } from "./ts/markdown/plantumlRender";
import { previewImage } from "./ts/preview/image";
import { Constants, VDITOR_VERSION } from "./ts/constants";
import { Hint } from "./ts/hint/index";
import { IR } from "./ts/ir/index";
import { input as irInput } from "./ts/ir/input";
import { processAfterRender } from "./ts/ir/process";
import { getHTML } from "./ts/markdown/getHTML";
import { getMarkdown } from "./ts/markdown/getMarkdown";
import { setLute } from "./ts/markdown/setLute";
import { Outline } from "./ts/outline/index";
import { Tip } from "./ts/tip/index";
import { Toolbar } from "./ts/toolbar/index";
import { disableToolbar, hidePanel } from "./ts/toolbar/setToolbar";
import { enableToolbar } from "./ts/toolbar/setToolbar";
import { AIDialog } from "./ts/ui/aiDialog";
import { AIReviewPanel } from "./ts/ui/aiReviewPanel";
import { initUI } from "./ts/ui/initUI";
import { applyCodeMirrorTheme } from "./ts/ui/setCodeTheme";
import { setColorTheme, setPageTheme } from "./ts/ui/setEditorTheme";
import { applyMermaidTheme } from "./ts/ui/setMermaidTheme";
import { setEditMode } from "./ts/toolbar/EditMode";
import { setTheme } from "./ts/ui/setTheme";
import { Undo } from "./ts/undo/index";
import { Upload } from "./ts/upload/index";
import { addScript } from "./ts/util/addScript";
import { clearCacheFocus, restoreCacheFocus } from "./ts/util/cacheFocus";
import { accessLocalStorage } from "./ts/util/compatibility";
import { clearDocumentScroll, restoreDocumentScroll } from "./ts/util/documentState";
import { getSelectText } from "./ts/util/getSelectText";
import { Options } from "./ts/util/Options";
import { processCodeRender } from "./ts/util/processCode";
import { hasClosestBlock } from "./ts/util/hasClosest";
import { getCursorPosition, getEditorRange, insertHTML, insertMdForAIReplace, setSelectionFocus } from "./ts/util/selection";
import { markOutlineEditing } from "./ts/outline/updateOutlineActive";
import { recordHistoryChange } from "./ts/util/instantHistory";
import {
    captureEditorSelection,
    hideFrozenSelection,
    restoreEditorSelection,
    showFrozenSelection,
} from "./ts/util/frozenSelection";
import { afterRenderEvent } from "./ts/wysiwyg/afterRenderEvent";
import { renderToc } from "./ts/util/toc";
import { scrollToBlock as scrollToBlockUtil } from "./ts/util/scrollToBlock";
import { configureHistoryDeferByDocumentLength } from "./ts/util/historySchedule";
import { isDocumentDirty, markDocumentSaved, updateSaveToolbarState } from "./ts/util/saveToolbarState";
import {
    applyEditorSettings,
    enableViewerSettingsSync,
    exportViewerSettings,
    getGlobalLocalStorageSetting,
    importViewerSettings,
    setAIModelKeySink,
    setOnViewerSettingsChange,
    ViewerSettingsExport,
} from "./ts/util/globalLocalStorageSettings";
import { exportExportSettings, ExportThemeSettings } from "./ts/util/exportThemeSettings";
import {
    buildSettingsPanelHTML,
    refreshAISettingsToolbarPanel,
    refreshSettingsToolbarPanel,
} from "./ts/ui/settingsPanel";
import { WYSIWYG } from "./ts/wysiwyg/index";
import { input } from "./ts/wysiwyg/input";
import { ensureEditorBoundaryParagraphs, renderDomByMd } from "./ts/wysiwyg/renderDomByMd";

class Vditor {
    public static adapterRender = adapterRender;
    public static previewImage = previewImage;
    public static codeRender = codeRender;
    public static codeMirrorPreviewRender = codeMirrorPreviewRender;
    public static mathRender = mathRender;
    public static mermaidRender = mermaidRender;
    public static plantumlRender = plantumlRender;
    public static outlineRender = outlineRender;

    public readonly version: string;
    public vditor: IVditor;
    private aiDialog: AIDialog | null = null;
    private aiSelectionRange: Range | null = null;
    private aiReviewPanel: AIReviewPanel = new AIReviewPanel();
    private aiReplaceAll = false;

    /**
     * @param id The element, or element ID, to mount Vditor on.
     * @param options Vditor options
     */
    constructor(id: string | HTMLElement, options?: IOptions) {
        this.version = VDITOR_VERSION;

        if (typeof id === "string") {
            if (!options) {
                options = {
                    cache: {
                        id: `vditor${id}`,
                    },
                };
            } else if (!options.cache) {
                options.cache = { id: `vditor${id}` };
            } else if (!options.cache.id) {
                options.cache.id = `vditor${id}`;
            }
            id = document.getElementById(id);
        }

        const getOptions = new Options(options);
        const mergedOptions = getOptions.merge();
        if (mergedOptions.ai?.onSetModelKey) {
            setAIModelKeySink(mergedOptions.ai.onSetModelKey);
        }

        // Support custom i18n
        if (!mergedOptions.i18n) {
            if (!["en_US", "ja_JP", "ko_KR", "ru_RU", "zh_CN", "zh_TW"].includes(mergedOptions.lang)) {
                throw new Error(
                    "options.lang error, see https://ld246.com/article/1549638745630#options",
                );
            } else {
                const i18nScriptPrefix = "vditorI18nScript";
                const i18nScriptID = i18nScriptPrefix + mergedOptions.lang;
                document.querySelectorAll(`head script[id^="${i18nScriptPrefix}"]`).forEach((el) => {
                    if (el.id !== i18nScriptID) {
                        document.head.removeChild(el);
                    }
                });
                addScript(`${mergedOptions.cdn}/dist/js/i18n/${mergedOptions.lang}.js`, i18nScriptID).then(() => {
                    this.init(id as HTMLElement, mergedOptions);
                });
            }
        } else {
            window.VditorI18n = mergedOptions.i18n;
            this.init(id, mergedOptions);
        }
    }

    /** Set the theme */
    public setTheme(
        theme: "dark" | "classic",
        codeTheme?: string,
    ) {
        this.vditor.options.theme = theme;
        setTheme(this.vditor);
        if (codeTheme) {
            applyCodeMirrorTheme(this.vditor, codeTheme, false);
        }
    }

    /** Follow a new vscode-office.theme value: auto, light or dark */
    public setColorTheme(colorTheme: string) {
        setColorTheme(this.vditor, colorTheme);
    }

    /** Follow a new vscode-office.markdown.theme value for the page: auto, light or dark */
    public setPageTheme(pageTheme: string) {
        setPageTheme(this.vditor, pageTheme);
    }

    /** Set the code block theme (does not fire the changeCodeTheme callback) */
    public setCodeMirrorTheme(codeMirrorTheme: string) {
        applyCodeMirrorTheme(this.vditor, codeMirrorTheme, false);
    }

    /** Set the Mermaid theme (does not fire the changeMermaidTheme callback) */
    public setMermaidTheme(mermaidTheme: string) {
        applyMermaidTheme(this.vditor, mermaidTheme, false);
    }

    /** Switch the edit mode (does not fire the changeEditMode callback) */
    public switchEditMode(mode: "wysiwyg" | "ir") {
        if (this.vditor.currentMode === mode) {
            return;
        }
        setEditMode(this.vditor, mode, this.getValue());
    }

    /** Get the Markdown content */
    public getValue() {
        return getMarkdown(this.vditor);
    }

    /** Mark the current content as saved and disable the toolbar save button */
    public markSaved(markdown?: string) {
        markDocumentSaved(this.vditor, markdown);
    }

    /** Whether the document has changed since the last save */
    public isDirty() {
        return isDocumentDirty(this.vditor);
    }

    /** Get the editor's current edit mode */
    public getCurrentMode() {
        return this.vditor.currentMode;
    }

    /** Focus the editor */
    public focus() {
        if (this.vditor.currentMode === "wysiwyg") {
            this.vditor.wysiwyg.element.focus();
        } else if (this.vditor.currentMode === "ir") {
            this.vditor.ir.element.focus();
        }
    }

    /** Blur the editor */
    public blur() {
        if (this.vditor.currentMode === "wysiwyg") {
            this.vditor.wysiwyg.element.blur();
        } else if (this.vditor.currentMode === "ir") {
            this.vditor.ir.element.blur();
        }
    }

    /** Disable the editor */
    public disabled() {
        hidePanel(this.vditor, ["subToolbar", "hint", "popover"]);
        disableToolbar(
            this.vditor.toolbar.elements,
            Constants.EDIT_TOOLBARS.concat(["undo", "redo", "edit-mode"]),
        );
        this.vditor[this.vditor.currentMode].element.setAttribute(
            "contenteditable",
            "false",
        );
    }

    /** Re-enable the editor */
    public enable() {
        enableToolbar(
            this.vditor.toolbar.elements,
            Constants.EDIT_TOOLBARS.concat(["undo", "redo", "edit-mode"]),
        );
        this.vditor.undo.resetIcon(this.vditor);
        this.vditor[this.vditor.currentMode].element.setAttribute("contenteditable", "true");
    }

    /** Return the selected text */
    public getSelection() {
        if (this.vditor.currentMode === "wysiwyg") {
            return getSelectText(this.vditor.wysiwyg.element);
        }
        if (this.vditor.currentMode === "ir") {
            return getSelectText(this.vditor.ir.element);
        }
    }

    /** Get the cursor position */
    public getCursorPosition() {
        return getCursorPosition(this.vditor[this.vditor.currentMode].element);
    }

    /** Restore the last cursor position; onLoad is for the first page load */
    public restoreFocus(onLoad = false) {
        restoreCacheFocus(this.vditor, { onLoad });
    }

    /** Restore the document scroll position */
    public restoreScroll(scrollTop?: number) {
        restoreDocumentScroll(this.vditor, scrollTop);
    }

    /** Restore scroll and cursor position; onLoad is for the first page load */
    public restoreDocumentSession(onLoad = false, restoreCaret = true) {
        restoreCacheFocus(this.vditor, { onLoad, restoreCaret });
    }

    /** Scroll to a block reference or heading fragment (e.g. ^block-id or a heading slug) */
    public scrollToBlock(fragment: string) {
        return scrollToBlockUtil(this.vditor, fragment);
    }

    /** Whether an upload is still in progress */
    public isUploading() {
        return this.vditor.upload.isUploading;
    }

    /** Clear the cache */
    public clearCache() {
        if (accessLocalStorage()) {
            const cacheId = this.vditor.options.cache.id;
            if (cacheId) {
                localStorage.removeItem(cacheId);
                clearCacheFocus(cacheId);
                clearDocumentScroll(cacheId);
            }
        }
    }

    /** Disable the cache */
    public disabledCache() {
        this.vditor.options.cache.enable = false;
    }

    /** Enable the cache */
    public enableCache() {
        if (!this.vditor.options.cache.id) {
            throw new Error(
                "need options.cache.id, see https://ld246.com/article/1549638745630#options",
            );
        }
        this.vditor.options.cache.enable = true;
    }

    /** Convert HTML to Markdown */
    public html2md(value: string) {
        return this.vditor.lute.HTML2Md(value);
    }

    /** Convert Markdown to JSON */
    public exportJSON(value: string) {
        return this.vditor.lute.RenderJSON(value);
    }

    /** Get the HTML */
    public getHTML() {
        return getHTML(this.vditor);
    }

    /** Show a message. A time of 0 keeps it displayed */
    public tip(text: string, time?: number) {
        this.vditor.tip.show(text, time);
    }

    /** Delete the selected content */
    public deleteValue() {
        if (window.getSelection().isCollapsed) {
            return;
        }
        document.execCommand("delete", false);
    }

    /** Update the selected content */
    public updateValue(value: string) {
        document.execCommand("insertHTML", false, value);
    }

    /** Insert content at the cursor, rendered as Markdown by default */
    public insertValue(value: string, render = true) {
        const range = getEditorRange(this.vditor);
        range.collapse(true);
        const tmpElement = document.createElement("template");
        tmpElement.innerHTML = value;
        range.insertNode(tmpElement.content.cloneNode(true));
        if (this.vditor.currentMode === "wysiwyg") {
            this.vditor.wysiwyg.preventInput = true;
            if (render) {
                input(this.vditor, getSelection().getRangeAt(0));
            }
        } else if (this.vditor.currentMode === "ir") {
            this.vditor.ir.preventInput = true;
            if (render) {
                irInput(this.vditor, getSelection().getRangeAt(0), true);
            }
        }
    }

    /** Insert Markdown at the cursor, behaving like pasting plain-text Markdown */
    public insertMarkdown(markdown: string) {
        const vditor = this.vditor;
        vditor[vditor.currentMode].element.focus();
        if (vditor.currentMode === "ir") {
            insertHTML(vditor.lute.Md2VditorIRDOM(markdown), vditor);
        } else if (vditor.currentMode === "wysiwyg") {
            insertHTML(vditor.lute.Md2VditorDOM(markdown), vditor);
        } else {
            document.execCommand("insertText", false, markdown);
        }
        markOutlineEditing(vditor);
        vditor.outline.render(vditor);
        recordHistoryChange(vditor);
    }

    /** Set the editor content */
    public setValue(markdown: string, clearStack = false) {
        if (this.vditor.currentMode === "wysiwyg") {
            renderDomByMd(this.vditor, markdown, {
                enableAddUndoStack: true,
                enableHint: false,
                enableInput: false,
            });
        } else {
            this.vditor.ir.element.innerHTML = this.vditor.lute.Md2VditorIRDOM(markdown);
            this.vditor.ir.element
                .querySelectorAll(".vditor-ir__preview[data-render='2']")
                .forEach((item: HTMLElement) => {
                    processCodeRender(item, this.vditor);
                });
            ensureEditorBoundaryParagraphs(this.vditor.ir.element);
            processAfterRender(this.vditor, {
                enableAddUndoStack: true,
                enableHint: false,
                enableInput: false,
            });
        }

        renderToc(this.vditor);

        if (!markdown) {
            hidePanel(this.vditor, ["headings", "submenu", "hint"]);
            if (this.vditor.wysiwyg.popover) {
                this.vditor.wysiwyg.popover.style.display = "none";
            }
            this.clearCache();
        }
        if (clearStack) {
            this.clearStack();
            configureHistoryDeferByDocumentLength(this.vditor, markdown.length);
        }
        updateSaveToolbarState(this.vditor);
    }

    /** Clear the undo & redo stacks */
    public clearStack() {
        this.vditor.undo.clearStack(this.vditor);
        this.vditor.undo.addToUndoStack(this.vditor);
    }

    /** Set whether GitHub Copilot (VS Code Language Model API) is available */
    public setCopilotAvailable(available: boolean) {
        this.aiDialog?.setCopilotAvailable(available);
    }

    /** Set the list of available VS Code language models */
    public setVSCodeModels(models: Array<{ id: string; name: string; family: string; vendor: string }>) {
        this.aiDialog?.setVSCodeModels(models);
    }

    /** Enable or disable config file sync */
    public setViewerSettingsSyncEnabled(enabled: boolean) {
        enableViewerSettingsSync(enabled);
    }

    /** Export the current global settings (to write to the config file) */
    public exportViewerSettings(): ViewerSettingsExport {
        return exportViewerSettings();
    }

    /** Import and apply global settings from the config file */
    public applyViewerSettings(data: ViewerSettingsExport) {
        importViewerSettings(data);
        applyEditorSettings(this.vditor.element);
        const outlineWidth = getGlobalLocalStorageSetting<number>("outlineWidth");
        if (outlineWidth && this.vditor.outline?.element) {
            this.vditor.outline.element.style.width = `${outlineWidth}px`;
        }
        const outlineEnable = getGlobalLocalStorageSetting<boolean>("outlineEnable");
        if (outlineEnable !== undefined) {
            this.vditor.options.outline.enable = outlineEnable === true || outlineEnable === "true";
        }
        const settingsItem = this.vditor.toolbar.elements.settings;
        const panelElement = settingsItem?.querySelector(".vditor-hint") as HTMLElement | null;
        if (panelElement) {
            panelElement.innerHTML = buildSettingsPanelHTML(this.vditor);
        }
        refreshSettingsToolbarPanel(this.vditor);
        refreshAISettingsToolbarPanel(this.vditor);
    }

    /** Open the AI polish dialog; called externally (context menu, etc.) */
    public openAIPolishDialog() {
        if (!this.aiDialog) { return; }
        const sel = this.getSelection();
        this.aiSelectionRange = captureEditorSelection(this.vditor);
        if (this.aiSelectionRange) {
            showFrozenSelection(this.vditor, this.aiSelectionRange);
        }
        this.aiDialog.open(sel || this.getValue(), !!sel);
    }

    /** Trigger AI polish. capturedMarkdown/isSelection are captured by the caller before blur, so the selection is not lost */
    public triggerAIPolish(options?: IAIPolishOptions, capturedMarkdown?: string, isSelection?: boolean) {
        const onPolish = this.vditor.options.ai?.onPolish;
        if (!onPolish) { return; }
        const replaceAll = isSelection !== undefined ? !isSelection : !this.getSelection();
        this.aiReplaceAll = replaceAll;
        const markdown = capturedMarkdown ?? (this.getSelection() || this.getValue());
        this.disabled();
        if (this.aiSelectionRange) {
            showFrozenSelection(this.vditor, this.aiSelectionRange);
        }
        const finishReview = (cancel = false, restoreSelection = true) => {
            const range = this.aiSelectionRange;
            const hadSelection = !!range && !this.aiReplaceAll;
            this.enable();
            hideFrozenSelection(this.vditor);
            this.aiSelectionRange = null;
            this.aiReviewPanel.close();
            if (restoreSelection && hadSelection) {
                restoreEditorSelection(this.vditor, range);
            } else if (restoreSelection) {
                this.focus();
            }
            if (cancel) {
                this.vditor.options.ai?.onCancelPolish?.();
            }
        };
        this.aiReviewPanel.open(
            markdown,
            {
                onAccept: (result) => {
                    const range = this.aiSelectionRange?.cloneRange() || null;
                    finishReview(false, false);
                    this.applyAIResult(result, this.aiReplaceAll, range);
                },
                onReject: () => finishReview(false),
                onStop: () => finishReview(true),
            },
        );
        onPolish(markdown, (_result: string) => { /* streaming via streamAIChunk/endAIStream */ }, options);
    }

    /** Receive a streamed AI chunk and update the diff review panel live */
    public streamAIChunk(chunk: string) {
        this.aiReviewPanel.stream(chunk);
    }

    /** The AI stream ended: enable the Accept button; failed: the request failed, there is nothing to accept */
    public endAIStream(failed = false) {
        this.aiReviewPanel.endStream(failed);
    }

    /** Receive the AI polish result: leave the loading state and merge the Markdown into the document */
    public applyAIResult(markdown: string, replaceAll = false, selectionRange?: Range | null) {
        this.enable();
        hideFrozenSelection(this.vditor);
        if (replaceAll) {
            this.aiSelectionRange = null;
            this.setValue(markdown);
        } else {
            const range = selectionRange ?? this.aiSelectionRange;
            this.aiSelectionRange = null;
            const editor = this.vditor[this.vditor.currentMode].element;
            const hostBlock = hasClosestBlock(range.startContainer) as HTMLElement | null;
            if (range && !range.collapsed
                && editor.contains(range.startContainer)
                && editor.contains(range.endContainer)) {
                this.vditor[this.vditor.currentMode].preventInput = true;
                range.deleteContents();
                range.collapse(true);
                setSelectionFocus(range);
                this.vditor[this.vditor.currentMode].range = range;
            } else {
                restoreEditorSelection(this.vditor, range);
                this.vditor[this.vditor.currentMode].preventInput = true;
                document.execCommand("delete", false);
            }
            const editorHTML = this.vditor.currentMode === "wysiwyg"
                ? this.vditor.lute.Md2VditorDOM(markdown.trim())
                : this.vditor.lute.Md2VditorIRDOM(markdown.trim());
            insertMdForAIReplace(editorHTML, this.vditor, hostBlock);
            editor.querySelectorAll(`.vditor-${this.vditor.currentMode}__preview[data-render='2']`)
                .forEach((item: HTMLElement) => {
                    processCodeRender(item, this.vditor);
                });
            if (this.vditor.currentMode === "wysiwyg") {
                renderCodeBlocks(this.vditor);
            }
            recordHistoryChange(this.vditor);
        }
    }

    /** Destroy the editor */
    public destroy() {
        this.vditor.element.innerHTML = this.vditor.originalInnerHTML;
        this.vditor.element.classList.remove("vditor");
        this.vditor.element.removeAttribute("style");
        this.clearCache();

        this.vditor.wysiwyg.unbindListener();
    }

    private init(id: HTMLElement, mergedOptions: IOptions) {
        this.vditor = {
            currentMode: mergedOptions.mode,
            element: id,
            hint: new Hint(mergedOptions.hint.extend),
            lute: undefined,
            options: mergedOptions,
            originalInnerHTML: id.innerHTML,
            outline: new Outline(window.VditorI18n.outline),
            tip: new Tip(),
        };

        this.vditor.undo = new Undo();
        this.vditor.wysiwyg = new WYSIWYG(this.vditor);
        this.vditor.ir = new IR(this.vditor);
        this.vditor.toolbar = new Toolbar(this.vditor);

        if (typeof mergedOptions.onSettingsChange === "function") {
            setOnViewerSettingsChange((settings) => mergedOptions.onSettingsChange?.(settings));
        }

        if (mergedOptions.upload.url || mergedOptions.upload.handler) {
            this.vditor.upload = new Upload();
        }

        addScript(
            mergedOptions._lutePath ||
            `${mergedOptions.cdn}/dist/js/lute/lute.min.js`,
            "vditorLuteScript",
        ).then(() => {
            this.vditor.lute = setLute({
                autoSpace: this.vditor.options.preview.markdown.autoSpace,
                codeBlockPreview: this.vditor.options.preview.markdown
                    .codeBlockPreview,
                fixTermTypo: this.vditor.options.preview.markdown.fixTermTypo,
                footnotes: this.vditor.options.preview.markdown.footnotes,
                headingAnchor: false,
                inlineMathDigit: this.vditor.options.preview.math.inlineDigit,
                linkBase: this.vditor.options.preview.markdown.linkBase,
                linkPrefix: this.vditor.options.preview.markdown.linkPrefix,
                listStyle: this.vditor.options.preview.markdown.listStyle,
                mark: this.vditor.options.preview.markdown.mark,
                obsidian: this.vditor.options.preview.markdown.obsidian,
                mathBlockPreview: this.vditor.options.preview.markdown
                    .mathBlockPreview,
                paragraphBeginningSpace: this.vditor.options.preview.markdown
                    .paragraphBeginningSpace,
                sanitize: this.vditor.options.preview.markdown.sanitize,
                toc: this.vditor.options.preview.markdown.toc,
            });

            initUI(this.vditor);

            if (mergedOptions.ai?.onPolish) {
                this.aiDialog = new AIDialog(this.vditor, (markdown, isSelection, options) => {
                    this.triggerAIPolish(options, markdown, isSelection);
                }, (reason) => {
                    if (reason !== "submit") {
                        hideFrozenSelection(this.vditor);
                        this.aiSelectionRange = null;
                    }
                });
            }

            if (mergedOptions.after) {
                mergedOptions.after();
            }
        });
    }
}

export default Vditor;
