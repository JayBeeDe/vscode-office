import { getCachedNumberingMap } from "@eigenpal/docx-editor-core/docx";
import { applyStyle, setAlignment } from "@eigenpal/docx-editor-core/prosemirror/commands";
import { createStyleResolver } from "@eigenpal/docx-editor-core/prosemirror/styles";
import { useTranslation, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import { ToolbarButton, ToolbarGroup } from "@eigenpal/docx-editor-react/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { $t } from "../../i18n/i18nConfig.ts";

// the editor's own Material icons (it does not export them), viewBox 0 -960 960 960
const ICONS = {
    alignLeft: "M120-120v-80h720v80H120Zm0-160v-80h480v80H120Zm0-160v-80h720v80H120Zm0-160v-80h480v80H120Zm0-160v-80h720v80H120Z",
    alignCenter: "M120-120v-80h720v80H120Zm160-160v-80h400v80H280ZM120-440v-80h720v80H120Zm160-160v-80h400v80H280ZM120-760v-80h720v80H120Z",
    alignRight: "M120-760v-80h720v80H120Zm240 160v-80h480v80H360ZM120-440v-80h720v80H120Zm240 160v-80h480v80H360ZM120-120v-80h720v80H120Z",
    justify: "M120-120v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Zm0-160v-80h720v80H120Z",
    outline: "M360-200v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360ZM200-160q-33 0-56.5-23.5T120-240q0-33 23.5-56.5T200-320q33 0 56.5 23.5T280-240q0 33-23.5 56.5T200-160Zm0-240q-33 0-56.5-23.5T120-480q0-33 23.5-56.5T200-560q33 0 56.5 23.5T280-480q0 33-23.5 56.5T200-400Zm-56.5-263.5Q120-687 120-720t23.5-56.5Q167-800 200-800t56.5 23.5Q280-753 280-720t-23.5 56.5Q233-640 200-640t-56.5-23.5Z",
    save: "M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z",
    pageSetup: "m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z",
    image: "M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z",
    table: "M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h133v-133H200v133Zm213 0h134v-133H413v133Zm214 0h133v-133H627v133ZM200-413h133v-134H200v134Zm213 0h134v-134H413v134Zm214 0h133v-134H627v134ZM200-627h133v-133H200v133Zm213 0h134v-133H413v133Zm214 0h133v-133H627v133Z",
    pageBreak: "M120-440v-80h160v80H120Zm200 0v-80h160v80H320Zm200 0v-80h160v80H520Zm200 0v-80h120v80H720ZM240-120q-33 0-56.5-23.5T160-200v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-120H240Zm-80-520v-120q0-33 23.5-56.5T240-840h480q33 0 56.5 23.5T800-760v120h-80v-120H240v120h-80Z",
    tableOfContents: "M120-80v-60h100v-30h-60v-60h60v-30H120v-60h120q17 0 28.5 11.5T280-280v40q0 17-11.5 28.5T240-200q17 0 28.5 11.5T280-160v40q0 17-11.5 28.5T240-80H120Zm0-280v-110q0-17 11.5-28.5T160-510h60v-30H120v-60h120q17 0 28.5 11.5T280-560v70q0 17-11.5 28.5T240-450h-60v30h100v60H120Zm60-280v-180h-60v-60h120v240h-60Zm180 440v-80h480v80H360Zm0-240v-80h480v80H360Zm0-240v-80h480v80H360Z",
    link: "M440-280H280q-83 0-141.5-58.5T80-480q0-83 58.5-141.5T280-680h160v80H280q-50 0-85 35t-35 85q0 50 35 85t85 35h160v80ZM320-440v-80h320v80H320Zm200 160v-80h160q50 0 85-35t35-85q0-50-35-85t-85-35H520v-80h160q83 0 141.5 58.5T880-480q0 83-58.5 141.5T680-280H520Z",
    watermark: "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm320-60q66 0 113-37t47-93q0-29-13-58t-34-55q-21-26-50-49t-50-31q-21 8-50 31t-50 49q-21 26-34 55t-13 58q0 56 47 93t140 37Z",
};

/** the menus' items: their icons are named after their keys */
type ItemIcon = Exclude<keyof typeof ICONS, "outline" | "link" | "alignLeft" | "alignCenter" | "alignRight" | "justify">;

function Icon({ name }: { name: keyof typeof ICONS }) {
    return (
        <svg width={18} height={18} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
            <path d={ICONS[name]} />
        </svg>
    );
}

/**
 * An element of the editor, followed as it re-renders (the editor tells nothing of what it shows)
 * @param find looks the element up; it must not change between renders
 */
function useEditorElement<T extends Element>(find: () => T | null) {
    const [element, setElement] = useState(find);
    useEffect(() => {
        const update = () => setElement(find());
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return element;
}

// the table size grid, as in the editor's Insert menu
const GRID_SIZE = 6;

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

/** what the menus' items are matched with: their label, as the editor shows it */
const labelOf = (element: Element) => element.querySelector(":scope > button > span")?.textContent;

/**
 * The menu bar is hidden (Word.css) and the editor has no API for its actions: the buttons open a
 * menu and pick an item in it, so the editor's own dialogs and commands run.
 */
async function openMenu(menuLabel: string) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="title-bar"] [role="menubar"] > div > button'))
        .find(menuButton => menuButton.textContent === menuLabel);
    if (!button) {
        console.warn(`Document menu not found: ${menuLabel}`);
        return undefined;
    }
    // the button toggles the menu: a click on a menu left open would close it
    if (!button.nextElementSibling) {
        button.click();
        await nextFrame();
    }
    const dropdown = button.nextElementSibling;
    return { button, dropdown };
}

/** The item of the menu, its button and any submenu; the menu is closed when there is none. */
async function findMenuItem(menuLabel: string, itemLabel: string) {
    const menu = await openMenu(menuLabel);
    if (!menu) return undefined;
    const item = Array.from(menu.dropdown?.children ?? []).find(child => labelOf(child) === itemLabel);
    if (!item) {
        console.warn(`Document menu item not found: ${menuLabel} > ${itemLabel}`);
        menu.button.click();
        return undefined;
    }
    return item;
}

async function pickMenuItem(menuLabel: string, itemLabel: string) {
    const item = await findMenuItem(menuLabel, itemLabel);
    item?.querySelector<HTMLButtonElement>(":scope > button")?.click();
}

/** Shows the item's submenu (it opens on hover) and returns it. */
async function openSubmenu(menuLabel: string, itemLabel: string) {
    const item = await findMenuItem(menuLabel, itemLabel);
    if (!item) return undefined;
    item.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await nextFrame();
    return item;
}

async function pickSubmenuItem(menuLabel: string, itemLabel: string, subItemLabel: string) {
    const item = await openSubmenu(menuLabel, itemLabel);
    Array.from(item?.querySelectorAll<HTMLButtonElement>("button") ?? [])
        .find(button => button.querySelector("span")?.textContent === subItemLabel)
        ?.click();
}

async function insertTable(menuLabel: string, itemLabel: string, rows: number, columns: number) {
    const item = await openSubmenu(menuLabel, itemLabel);
    const cell = item?.querySelectorAll<HTMLElement>('[role="gridcell"]')[(rows - 1) * GRID_SIZE + columns - 1];
    if (!cell) return;
    // the grid takes the size from the cell under the pointer, then inserts on click
    cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await nextFrame();
    cell.click();
}

function TableButton({ title, onInsert }: { title: string; onInsert: (rows: number, columns: number) => void }) {
    const [open, setOpen] = useState(false);
    const [size, setSize] = useState({ rows: 0, columns: 0 });
    const wrapperRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: Event) => {
            if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrapperRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const closeOnBlur = () => setOpen(false);
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", close);
        window.addEventListener("blur", closeOnBlur);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", close);
            window.removeEventListener("blur", closeOnBlur);
        };
    }, [open]);

    const cells = [];
    for (let row = 1; row <= GRID_SIZE; row++) {
        for (let column = 1; column <= GRID_SIZE; column++) {
            const selected = row <= size.rows && column <= size.columns;
            cells.push(
                <div
                    key={`${row}-${column}`}
                    className={`document-table-grid__cell${selected ? " document-table-grid__cell--selected" : ""}`}
                    onMouseEnter={() => setSize({ rows: row, columns: column })}
                    onClick={() => {
                        setOpen(false);
                        onInsert(row, column);
                    }}
                />
            );
        }
    }

    return (
        <span ref={wrapperRef} className="document-table-button">
            <ToolbarButton title={title} active={open} onClick={() => { setSize({ rows: 0, columns: 0 }); setOpen(!open); }}>
                <Icon name="table" />
            </ToolbarButton>
            {open && (
                <div className="document-table-grid" onMouseDown={event => event.preventDefault()}>
                    <div className="document-table-grid__cells" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 18px)` }}>{cells}</div>
                    <div className="document-table-grid__size">{size.rows > 0 ? `${size.columns} × ${size.rows}` : title}</div>
                </div>
            )}
        </span>
    );
}

/**
 * The document outline's toggle: the editor's floating one, hidden (Word.css), opens it and the
 * outline's back arrow closes it; the editor tells nothing else when it is shown
 */
function OutlineButton() {
    const { t } = useTranslation();
    const outline = useEditorElement(() => document.querySelector(".docx-outline-nav"));
    const open = outline !== null;

    const toggle = () => {
        const closeLabel = t("documentOutline.closeAriaLabel");
        const button = open
            ? Array.from(outline.querySelectorAll("button")).find(close => close.getAttribute("aria-label") === closeLabel)
            : document.querySelector<HTMLButtonElement>(".docx-outline-toggle");
        button?.click();
    };

    return (
        <ToolbarButton title={open ? t("documentOutline.closeTitle") : t("editor.showDocumentOutline")} active={open} onClick={toggle}>
            <Icon name="outline" />
        </ToolbarButton>
    );
}

type TranslationKey = Parameters<ReturnType<typeof useTranslation>["t"]>[0];

/**
 * A group (or lone button) of the formatting bar, found by its label, tagged `data-document-group`
 * for Word.css (the editor gives its groups nothing else to be told apart)
 */
function useFormattingGroup(labelKey: TranslationKey, name: string) {
    const { t } = useTranslation();
    const label = t(labelKey);
    const group = useEditorElement(() => Array.from(document.querySelectorAll('[data-testid="formatting-bar"] > [aria-label]'))
        .find(element => element.getAttribute("aria-label") === label) ?? null);
    useEffect(() => group?.setAttribute("data-document-group", name), [group, name]);
    return group;
}

/**
 * The formatting bar's dropdowns close when the window loses focus, like the font family's: the
 * editor closes the others (font size, colors, line spacing, editing mode...) on an outside click or
 * Escape only, so an open one, a fixed popup inside the bar, is sent an Escape
 */
function useCloseDropdownsOnBlur() {
    useEffect(() => {
        const close = () => {
            if (document.querySelector('[data-testid="formatting-bar"] [style*="position: fixed"]')) {
                document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            }
        };
        window.addEventListener("blur", close);
        return () => window.removeEventListener("blur", close);
    }, []);
}

type EditorDocument = ReturnType<DocxEditorRef["getDocument"]>;
type EditorSelection = Parameters<Parameters<DocxEditorRef["onSelectionChange"]>[0]>[0];

/** The document and the selection, as they change */
function useEditorState(editorRef: RefObject<DocxEditorRef | null>) {
    const [docx, setDocx] = useState<EditorDocument>(null);
    const [selection, setSelection] = useState<EditorSelection>(null);
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        setDocx(editor.getDocument());
        const unsubscribeContent = editor.onContentChange(setDocx);
        const unsubscribeSelection = editor.onSelectionChange(setSelection);
        return () => {
            unsubscribeContent();
            unsubscribeSelection();
        };
    }, [editorRef]);
    return { docx, selection };
}

const editorView = (editorRef: RefObject<DocxEditorRef | null>) => editorRef.current?.getEditorRef()?.getView();

/** Items added to one of the editor's groups (Word.css places them) */
function GroupItems({ group, className, children }: { group: Element | null; className: string; children: ReactNode }) {
    return group && createPortal(<span className={`document-group-items ${className}`}>{children}</span>, group);
}

/** Buttons in the place of a group's dropdown, hidden (Word.css) */
function GroupButtons({ group, children }: { group: Element | null; children: ReactNode }) {
    return group && createPortal(<span className="document-group-buttons">{children}</span>, group);
}

const HEADING_LEVELS = [1, 2, 3, 4, 5];

/**
 * H1 to H5, in the place of the paragraph style dropdown; the active heading's button turns its
 * paragraphs back into normal text. A heading the document does not define is disabled, as the
 * dropdown only offered the document's styles (Heading 1 to 3 when it has none).
 */
function HeadingButtons({ editorRef, docx, styleId }: { editorRef: RefObject<DocxEditorRef | null>; docx: EditorDocument; styleId: string | null }) {
    const group = useFormattingGroup("formattingBar.groups.styles", "styles");
    const styles = docx?.package.styles;
    const resolver = useMemo(() => styles ? createStyleResolver(styles) : null, [styles]);
    const defined = (level: number) => resolver && resolver.getParagraphStyles().length > 0
        ? resolver.hasParagraphStyle(`Heading${level}`)
        : level <= 3;

    // as the editor applies the dropdown's style: with the formatting the document gives it
    const apply = (level: number) => {
        const view = editorView(editorRef);
        if (!view) return;
        const style = styleId === `Heading${level}` ? "Normal" : `Heading${level}`;
        view.focus();
        if (resolver) {
            const { paragraphFormatting, runFormatting } = resolver.resolveParagraphStyle(style);
            const numbering = docx?.package.numbering ? getCachedNumberingMap(docx.package.numbering) : null;
            applyStyle(style, { paragraphFormatting, runFormatting, numbering })(view.state, view.dispatch);
        } else {
            applyStyle(style)(view.state, view.dispatch);
        }
    };

    return (
        <GroupButtons group={group}>
            {HEADING_LEVELS.map(level => (
                <ToolbarButton
                    key={level}
                    title={$t("document.heading", { level })}
                    active={styleId === `Heading${level}`}
                    disabled={!defined(level)}
                    onClick={() => apply(level)}
                >
                    <span className="document-heading-label">{`H${level}`}</span>
                </ToolbarButton>
            ))}
        </GroupButtons>
    );
}

const ALIGNMENTS = [
    { value: "left", icon: "alignLeft", labelKey: "alignment.alignLeft", shortcutKey: "alignment.alignLeftShortcut" },
    { value: "center", icon: "alignCenter", labelKey: "alignment.center", shortcutKey: "alignment.centerShortcut" },
    { value: "right", icon: "alignRight", labelKey: "alignment.alignRight", shortcutKey: "alignment.alignRightShortcut" },
    { value: "both", icon: "justify", labelKey: "alignment.justify", shortcutKey: "alignment.justifyShortcut" },
] as const;

/** Left, center, right and justify, in the place of the alignment dropdown */
function AlignmentButtons({ editorRef, alignment }: { editorRef: RefObject<DocxEditorRef | null>; alignment: string }) {
    const { t } = useTranslation();
    const group = useFormattingGroup("formattingBar.groups.alignment", "alignment");

    const apply = (value: typeof ALIGNMENTS[number]["value"]) => {
        const view = editorView(editorRef);
        if (!view) return;
        view.focus();
        setAlignment(value)(view.state, view.dispatch);
    };

    return (
        <GroupButtons group={group}>
            {ALIGNMENTS.map(({ value, icon, labelKey, shortcutKey }) => {
                // the dropdown's tooltips: "Center (Ctrl+E)"
                const title = `${t(labelKey)} (${t(shortcutKey)})`;
                return (
                    <ToolbarButton key={value} title={title} active={alignment === value} onClick={() => apply(value)}>
                        <Icon name={icon} />
                    </ToolbarButton>
                );
            })}
        </GroupButtons>
    );
}

/** Insert link in the Insert group: it clicks the editor's own, hidden in its group (Word.css) */
function LinkButton() {
    const { t } = useTranslation();
    const label = t("formattingBar.insertLink");
    const insertLink = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-document-group="text-formatting"] > button'))
        .find(button => button.getAttribute("aria-label") === label)
        ?.click();
    return (
        <ToolbarButton title={t("formattingBar.insertLinkShortcut")} onClick={insertLink}>
            <Icon name="link" />
        </ToolbarButton>
    );
}

/** The editor's groups, tagged for Word.css to order them */
function useFormattingGroups() {
    const history = useFormattingGroup("formattingBar.groups.history", "history");
    const listFormatting = useFormattingGroup("formattingBar.groups.listFormatting", "list-formatting");
    useFormattingGroup("formattingBar.groups.font", "font");
    useFormattingGroup("formattingBar.groups.textFormatting", "text-formatting");
    useFormattingGroup("formattingBar.groups.script", "script");
    useFormattingGroup("formattingBar.groups.image", "image");
    useFormattingGroup("formattingBar.groups.table", "table");
    useFormattingGroup("formattingBar.groups.zoom", "zoom");
    useFormattingGroup("formattingBar.clearFormatting", "clear-formatting");
    return { history, listFormatting };
}

/**
 * The formatting bar, ordered by Word.css: the outline's toggle; Save, Undo and Redo; the headings
 * in the place of their dropdown; the lists; the fonts and text formatting; the alignments in the
 * place of their dropdown; the indents, the line spacing and Page setup; the link and the Insert
 * menu's items; the zoom; the editing mode and the comments on the far right. The File and Insert
 * menus' items open the hidden menus.
 */
export default function DocumentMenuButtons({ editorRef, onSave }: { editorRef: RefObject<DocxEditorRef | null>; onSave: () => void }) {
    const { t } = useTranslation();
    const { docx, selection } = useEditorState(editorRef);
    const { history, listFormatting } = useFormattingGroups();
    useCloseDropdownsOnBlur();
    const file = t("toolbar.file");
    const insert = t("toolbar.insert");
    const label = (icon: ItemIcon) => t(`toolbar.${icon}`);
    const item = (icon: ItemIcon, run: () => void) => (
        <ToolbarButton title={label(icon)} onClick={run}>
            <Icon name={icon} />
        </ToolbarButton>
    );
    const menuItem = (menu: string, icon: ItemIcon) =>
        item(icon, () => void pickMenuItem(menu, label(icon)));
    const breakItem = (icon: ItemIcon) =>
        item(icon, () => void pickSubmenuItem(insert, t("toolbar.break"), label(icon)));

    return (
        <>
            <ToolbarGroup label={t("documentOutline.title")} className="document-toolbar-start">
                <OutlineButton />
            </ToolbarGroup>
            <GroupItems group={history} className="document-group-items--save">
                {item("save", onSave)}
            </GroupItems>
            <div role="separator" className="w-px h-6 bg-border mx-1.5 document-separator document-separator--start" />
            <HeadingButtons editorRef={editorRef} docx={docx} styleId={selection?.styleId ?? null} />
            <AlignmentButtons editorRef={editorRef} alignment={selection?.paragraphFormatting.alignment ?? "left"} />
            <GroupItems group={listFormatting} className="document-group-items--page-setup">
                {menuItem(file, "pageSetup")}
            </GroupItems>
            <ToolbarGroup label={insert} className="document-toolbar-insert">
                <LinkButton />
                {menuItem(insert, "image")}
                <TableButton
                    title={t("toolbar.table")}
                    onInsert={(rows, columns) => void insertTable(insert, t("toolbar.table"), rows, columns)}
                />
                {breakItem("pageBreak")}
                {menuItem(insert, "tableOfContents")}
                {menuItem(insert, "watermark")}
            </ToolbarGroup>
            <div role="separator" className="w-px h-6 bg-border mx-1.5 document-separator document-separator--insert" />
            <div role="separator" className="w-px h-6 bg-border mx-1.5 document-separator document-separator--end" />
        </>
    );
}
