declare module "*.svg";

declare module "*.png";

interface Window {
    VditorI18n: ITips;
}

/** CSS Custom Highlight API */
declare class Highlight {
    constructor(...ranges: Range[]);
}

interface CSSHighlights {
    set(name: string, highlight: Highlight): void;
    delete(name: string): void;
}

interface CSS {
    readonly highlights: CSSHighlights;
}

interface IObject {
    [key: string]: string;
}

type ITheme = "classic" | "dark";
type IEditMode = "wysiwyg" | "ir";
/** The extension's vscode-office.theme setting. */
type IColorTheme = "auto" | "light" | "dark";
type ICodeMirrorTheme = "auto" | "light" | "dark";
type IMermaidTheme =
    "auto" |
    "light" |
    "light-forest" |
    "light-ocean" |
    "light-sunset" |
    "dark" |
    "dark-dracula";

interface ILuteNode {
    TokensStr: () => string;
    __internal_object__: {
        Parent: {
            Type: number,
        },
        HeadingLevel: string,
    };
}

type ILuteRenderCallback = (node: ILuteNode, entering: boolean) => [string, number];

/** @link https://ld246.com/article/1588412297062 */
interface ILuteRender {
    renderDocument?: ILuteRenderCallback;
    renderParagraph?: ILuteRenderCallback;
    renderText?: ILuteRenderCallback;
    renderCodeBlock?: ILuteRenderCallback;
    renderCodeBlockOpenMarker?: ILuteRenderCallback;
    renderCodeBlockInfoMarker?: ILuteRenderCallback;
    renderCodeBlockCode?: ILuteRenderCallback;
    renderCodeBlockCloseMarker?: ILuteRenderCallback;
    renderMathBlock?: ILuteRenderCallback;
    renderMathBlockOpenMarker?: ILuteRenderCallback;
    renderMathBlockContent?: ILuteRenderCallback;
    renderMathBlockCloseMarker?: ILuteRenderCallback;
    renderBlockquote?: ILuteRenderCallback;
    renderBlockquoteMarker?: ILuteRenderCallback;
    renderHeading?: ILuteRenderCallback;
    renderHeadingC8hMarker?: ILuteRenderCallback;
    renderList?: ILuteRenderCallback;
    renderListItem?: ILuteRenderCallback;
    renderTaskListItemMarker?: ILuteRenderCallback;
    renderThematicBreak?: ILuteRenderCallback;
    renderHTML?: ILuteRenderCallback;
    renderTable?: ILuteRenderCallback;
    renderTableHead?: ILuteRenderCallback;
    renderTableRow?: ILuteRenderCallback;
    renderTableCell?: ILuteRenderCallback;
    renderFootnotesDef?: ILuteRenderCallback;
    renderCodeSpan?: ILuteRenderCallback;
    renderCodeSpanOpenMarker?: ILuteRenderCallback;
    renderCodeSpanContent?: ILuteRenderCallback;
    renderCodeSpanCloseMarker?: ILuteRenderCallback;
    renderInlineMath?: ILuteRenderCallback;
    renderInlineMathOpenMarker?: ILuteRenderCallback;
    renderInlineMathContent?: ILuteRenderCallback;
    renderInlineMathCloseMarker?: ILuteRenderCallback;
    renderEmphasis?: ILuteRenderCallback;
    renderEmAsteriskOpenMarker?: ILuteRenderCallback;
    renderEmAsteriskCloseMarker?: ILuteRenderCallback;
    renderEmUnderscoreOpenMarker?: ILuteRenderCallback;
    renderEmUnderscoreCloseMarker?: ILuteRenderCallback;
    renderStrong?: ILuteRenderCallback;
    renderStrongA6kOpenMarker?: ILuteRenderCallback;
    renderStrongA6kCloseMarker?: ILuteRenderCallback;
    renderStrongU8eOpenMarker?: ILuteRenderCallback;
    renderStrongU8eCloseMarker?: ILuteRenderCallback;
    renderStrikethrough?: ILuteRenderCallback;
    renderStrikethrough1OpenMarker?: ILuteRenderCallback;
    renderStrikethrough1CloseMarker?: ILuteRenderCallback;
    renderStrikethrough2OpenMarker?: ILuteRenderCallback;
    renderStrikethrough2CloseMarker?: ILuteRenderCallback;
    renderHardBreak?: ILuteRenderCallback;
    renderSoftBreak?: ILuteRenderCallback;
    renderInlineHTML?: ILuteRenderCallback;
    renderLink?: ILuteRenderCallback;
    renderOpenBracket?: ILuteRenderCallback;
    renderCloseBracket?: ILuteRenderCallback;
    renderOpenParen?: ILuteRenderCallback;
    renderCloseParen?: ILuteRenderCallback;
    renderLinkText?: ILuteRenderCallback;
    renderLinkSpace?: ILuteRenderCallback;
    renderLinkDest?: ILuteRenderCallback;
    renderLinkTitle?: ILuteRenderCallback;
    renderImage?: ILuteRenderCallback;
    renderBang?: ILuteRenderCallback;
    renderEmoji?: ILuteRenderCallback;
    renderEmojiUnicode?: ILuteRenderCallback;
    renderEmojiImg?: ILuteRenderCallback;
    renderEmojiAlias?: ILuteRenderCallback;
    renderToC?: ILuteRenderCallback;
    renderFootnotesRef?: ILuteRenderCallback;
    renderBackslash?: ILuteRenderCallback;
    renderBackslashContent?: ILuteRenderCallback;
}

interface ILuteOptions extends IMarkdownConfig {
    emojis: IObject;
    emojiSite: string;
    headingAnchor: boolean;
    inlineMathDigit: boolean;
    lazyLoadImage?: string;
}

declare class Lute {
    public static WalkStop: number;
    public static WalkSkipChildren: number;
    public static WalkContinue: number;
    public static Version: string;
    public static Caret: string;

    public static New(): Lute;

    public static EscapeHTMLStr(html: string): string;

    public static GetHeadingID(node: ILuteNode): string;

    public static NewNodeID(): string;

    public static Sanitize(html: string): string;

    public static KramdownIALID(): string;

    private constructor();

    public SetJSRenderers(options?: {
        renderers: {
            HTML2VditorDOM?: ILuteRender,
            HTML2VditorIRDOM?: ILuteRender,
            HTML2Md?: ILuteRender,
            Md2HTML?: ILuteRender,
            Md2VditorDOM?: ILuteRender,
            Md2VditorIRDOM?: ILuteRender,
        },
    }): void;

    public SetChineseParagraphBeginningSpace(enable: boolean): void;

    public SetHeadingID(enable: boolean): void;

    public SetRenderListStyle(enable: boolean): void;

    public SetLinkBase(url: string): void;

    public SetVditorIR(enable: boolean): void;

    public SetVditorWYSIWYG(enable: boolean): void;

    public SetLinkPrefix(url: string): void;

    public SetMark(enable: boolean): void;

    public SetObsidian(enable: boolean): void;

    public SetCallout(enable: boolean): void;

    public SetObsidianWikiLink(enable: boolean): void;

    public SetObsidianTag(enable: boolean): void;

    public SetSanitize(enable: boolean): void;

    public SetHeadingAnchor(enable: boolean): void;

    public SetImageLazyLoading(imagePath: string): void;

    public SetInlineMathAllowDigitAfterOpenMarker(enable: boolean): void;

    public SetToC(enable: boolean): void;

    public SetFootnotes(enable: boolean): void;

    public SetAutoSpace(enable: boolean): void;

    public SetFixTermTypo(enable: boolean): void;

    public SetEmojiSite(emojiSite: string): void;

    public SetVditorCodeBlockPreview(enable: boolean): void;

    public SetVditorMathBlockPreview(enable: boolean): void;

    public PutEmojis(emojis: IObject): void;

    public GetEmojis(): IObject;

    // Convert md to html
    public Md2HTML(markdown: string): string;

    // Convert html to md on paste
    public HTML2Md(html: string): string;

    // Convert wysiwyg to html
    public VditorDOM2HTML(vhtml: string): string;

    // wysiwyg input rendering
    public SpinVditorDOM(html: string): string;

    // Convert html to wysiwyg on paste
    public HTML2VditorDOM(html: string): string;

    // Convert wysiwyg to md
    public VditorDOM2Md(html: string): string;

    // Convert md to wysiwyg
    public Md2VditorDOM(markdown: string): string;

    // ir input rendering
    public SpinVditorIRDOM(markdown: string): string;

    // Get md from ir
    public VditorIRDOM2Md(html: string): string;

    // Convert md to ir
    public Md2VditorIRDOM(text: string): string;

    // Get HTML
    public VditorIRDOM2HTML(html: string): string;

    // Convert html to ir on paste
    public HTML2VditorIRDOM(html: string): string;

    // Convert markdown to a JSON structure https://github.com/88250/lute/issues/120
    public RenderJSON(markdown: string): string;
}

declare const webkitAudioContext: {
    prototype: AudioContext
    new(contextOptions?: AudioContextOptions): AudioContext,
};

interface ITips {
    [key: string]: string;
}

interface II18n {
    en_US: ITips;
    ja_JP: ITips;
    ko_KR: ITips;
    ru_RU: ITips;
    zh_CN: ITips;
    zh_TW: ITips;
}

/** @link https://ld246.com/article/1549638745630#options-upload */
interface IUpload {
    /** Upload URL */
    url?: string;
    /** Maximum upload file size in bytes */
    max?: number;
    /** When the clipboard contains image URLs, re-upload them using this URL */
    linkToImgUrl?: string;
    /** CORS upload token, sent as the X-Upload-Token header */
    token?: string;
    /** Accepted upload file types, same as [input accept](https://www.w3schools.com/tags/att_input_accept.asp) */
    accept?: string;
    /** Cross-site access control (withCredentials). Default: false */
    withCredentials?: boolean;
    /** Request headers */
    headers?: IObject;
    /** Extra request parameters */
    extraData?: { [key: string]: string | Blob };
    /** Whether multiple files can be uploaded at once. Default: true */
    multiple?: boolean;
    /** Upload field name. Default: file[] */
    fieldName?: string;

    /** Called before each upload to reset the request headers */
    setHeaders?(): IObject;

    /** Upload success callback */
    success?(editor: HTMLPreElement, msg: string): void;

    /** Upload failure callback */
    error?(msg: string): void;

    /** Sanitize file names. Default: name => name.replace(/\W/g, '') */
    filename?(name: string): string;

    /** Validation: return true on success, otherwise an error message */
    validate?(files: File[]): string | boolean;

    /** Custom upload; return an error message when an error occurs */
    handler?(files: File[]): string | null | Promise<string> | Promise<null>;

    /** Transform the server response to match the built-in data structure */
    format?(files: File[], responseText: string): string;

    /** Transform the server response (for linkToImgUrl) to match the built-in data structure */
    linkToImgFormat?(responseText: string): string;

    /** Process the files to upload and return them  */
    file?(files: File[]): File[] | Promise<File[]>;

    /** Callback after the image URLs are uploaded  */
    linkToImgCallback?(responseText: string): void;
}

/** @link https://ld246.com/article/1549638745630#options-toolbar */
interface IMenuItem {
    /** Unique identifier */
    name: string;
    /** SVG icon HTML */
    icon?: string;
    /** Element class name */
    className?: string;
    /** Tooltip */
    tip?: string;
    /** Keyboard shortcut, in ⌘/ctrl-key or ⌘/ctrl-⇧/shift-key format; not supported in wysiwyg mode */
    hotkey?: string;
    /** Suffix inserted into the editor */
    suffix?: string;
    /** Prefix inserted into the editor */
    prefix?: string;
    /** Tooltip position: ne, nw */
    tipPosition?: string;
    /** Submenu */
    toolbar?: Array<string | IMenuItem>;
    /** Menu level, at most 3; internal use */
    level?: number;

    /** Event fired when the custom button is clicked */
    click?(event: Event, vditor: IVditor): void;
}

/** @link https://ld246.com/article/1549638745630#options-preview-math */
interface IMath {
    /** Whether a digit is allowed right after the opening $ of inline math. Default: true */
    inlineDigit?: boolean;
    /** KaTeX macro definitions. Default: {} */
    macros?: object;
}

type ILinkClickType = "link" | "wikilink" | "wikilink-embed" | "image" | "tag" | "footnote-ref" | "link-ref";

type ILinkClickAction = "click" | "dblclick" | "auxclick";

interface ILinkClickPayload {
    type: ILinkClickType;
    /** Click / double-click / middle-click */
    action: ILinkClickAction;
    href: string;
    text: string;
    element: HTMLElement;
}

/** @link https://ld246.com/article/1549638745630#options-preview-markdown */
interface IMarkdownConfig {
    /** Automatic spacing. Default: false */
    autoSpace?: boolean;
    /** Whether to indent paragraphs with two spaces. Default: false */
    paragraphBeginningSpace?: boolean;
    /** Automatically fix terms. Default: false */
    fixTermTypo?: boolean;
    /** Insert a table of contents. Default: false */
    toc?: boolean;
    /** Footnotes. Default: true */
    footnotes?: boolean;
    /** Whether code blocks are rendered in wysiwyg & ir modes. Default: true */
    codeBlockPreview?: boolean;
    /** Whether math blocks are rendered in wysiwyg & ir modes. Default: true */
    mathBlockPreview?: boolean;
    /** Whether XSS filtering is enabled. Default: true */
    sanitize?: boolean;
    /** Prefix for relative link paths. Default: '' */
    linkBase?: string;
    /** Forced link prefix. Default: '' */
    linkPrefix?: string;
    /** Add markers to lists to allow [custom list styles](https://github.com/Vanessa219/vditor/issues/390). Default: false */
    listStyle?: boolean;
    /** Support the mark syntax */
    mark?: boolean;
    /** Obsidian syntax: callout, wikilink, #tag */
    obsidian?: boolean;
    /** Enable Obsidian callouts only (> [!note]) */
    callout?: boolean;
    /** Enable Obsidian wikilinks only ([[...]] / ![[...]]) */
    obsidianWikiLink?: boolean;
    /** Enable Obsidian tags only (#tag) */
    obsidianTag?: boolean;
}

/** @link https://ld246.com/article/1549638745630#options-preview */
interface IPreview {
    math?: IMath;
    markdown?: IMarkdownConfig;
}

interface IHintData {
    html: string;
    value: string;
    current?: boolean;
}

interface IHintExtend {
    key: string;

    hint?(value: string): IHintData[] | Promise<IHintData[]>;
}

/** @link https://ld246.com/article/1549638745630#options-hint */
interface IHint {
    /** Whether hint content is parsed as Markdown */
    parse?: boolean;
    /** Common emoji hint HTML */
    emojiTail?: string;
    /** Hint debounce interval in milliseconds. Default: 200 */
    delay?: number;
    /** Default emojis, chosen from [lute/emoji_map](https://github.com/88250/lute/blob/master/parse/emoji_map.go#L32) or custom */
    emoji?: IObject;
    /** Emoji image path. Default: 'https://unpkg.com/vditor@${VDITOR_VERSION}/dist/images/emoji' */
    emojiPath?: string;
    extend?: IHintExtend[];
}

/** @link https://ld246.com/article/1549638745630#options */
interface IAIPolishOptions {
    goal?: string;
    prompt?: string;
    engine?: "vscode" | "custom";
    /** auto = follow UI language */
    outputLanguage?: "auto" | "en_US" | "zh_CN" | "zh_TW" | "ja_JP" | "ko_KR" | "ru_RU";
    /** Current editor UI language (vditor.options.lang) */
    uiLanguage?: string;
    vscodeModelId?: string;
    customUrl?: string;
    /** id of the custom model, used by the host to look up its stored API key */
    customModelId?: string;
    customModel?: string;
    /** auto | openai | anthropic | gemini | ollama */
    customApiFormat?: "auto" | "openai" | "anthropic" | "gemini" | "ollama";
}

type ViewerSettingsExport = {
    globalSettings: Record<string, boolean | number | string | undefined>;
    aiPreferences: Record<string, string>;
};

interface IOptions {
    /** RTL */
    rtl?: boolean;
    /** History recording interval */
    undoDelay?: number;
    /** Used for internal debugging */
    _lutePath?: string;
    /** Initial editor value. Default: '' */
    value?: string;
    /** Whether to show logs. Default: false */
    debugger?: boolean;
    /** Whether to print the HTML before and after WYSIWYG input SpinVditorDOM. Default: false */
    wysiwygInputPerf?: boolean;
    /** Total editor height. Default: 'auto' */
    height?: number | string;
    /** Minimum editor height */
    minHeight?: number;
    /** Total editor width, % supported. Default: 'auto' */
    width?: number | string;
    /** Placeholder shown when the input area is empty. Default: '' */
    placeholder?: string;
    /** Language. Default: 'zh_CN' */
    lang?: (keyof II18n);
    /** i18n: custom language strings. Lower priority than lang */
    i18n?: ITips;
    /** @link https://ld246.com/article/1549638745630#options-toolbar */
    toolbar?: Array<string | IMenuItem>;
    /** @link https://ld246.com/article/1549638745630#options-counter */
    counter?: {
        enable: boolean;
        max?: number;
        type?: "markdown" | "text";
        after?(length: number, counter: {
            enable: boolean;
            max?: number;
            type?: "markdown" | "text"
        }): void
    };
    /** @link https://ld246.com/article/1549638745630#options-cache */
    cache?: {
        id?: string;
        /**
         * Saves the text to localStorage after each input event; on init, Vditor loads the stored data if any
         */
        enable?: boolean;
        /** Where the cursor position is cached. */
        focusHost?: "browser" | "vscode";
        after?(markdown: string): void;
    };
    /** Edit mode. Default: 'ir' */
    mode?: IEditMode;
    /** @link https://ld246.com/article/1549638745630#options-preview */
    preview?: IPreview;
    /** @link https://ld246.com/article/1549638745630#options-hint */
    hint?: IHint;
    /** @link https://ld246.com/article/1549638745630#options-toolbarConfig */
    toolbarConfig?: {
        hide?: boolean,
        pin?: boolean,
    };
    /** Theme. Default: 'classic' */
    theme?: ITheme;
    /** Light or dark: vscode-office.theme, `auto` following VS Code. Default: 'auto' */
    colorTheme?: IColorTheme | string;
    /** Light or dark page: vscode-office.markdown.theme, `auto` following colorTheme. Default: 'auto' */
    pageTheme?: IColorTheme | string;
    /** CodeMirror code block theme; `auto` follows the editor. Default: 'auto' */
    codeMirrorTheme?: ICodeMirrorTheme | string;
    /** Mermaid diagram theme; `auto` follows the editor. Default: 'auto' */
    mermaidTheme?: IMermaidTheme | string;
    /** Icon set. Default: 'ant' */
    icon?: "ant" | "material";
    /** @link https://ld246.com/article/1549638745630#options-upload */
    upload?: IUpload;
    /** Self-hosted CDN URL. Default: 'https://unpkg.com/vditor@${VDITOR_VERSION}' */
    cdn?: string;
    /** String inserted by the Tab key; \t or any string */
    tab?: string;
    /** @link https://ld246.com/article/1549638745630#options-outline */
    outline?: {
        enable: boolean,
        position: "left" | "right",
        /** Initial width, used when nothing is stored in localStorage */
        width?: number,
    };

    /** Callback after the editor finishes its async rendering */
    after?(): void;

    /** Fired after input */
    input?(value: string): void;

    /** Fired after the code block theme changes */
    changeCodeTheme?(value: string): void;

    /** Fired after the Mermaid theme changes */
    changeMermaidTheme?(value: string): void;

    /** AI feature configuration */
    ai?: {
        /** AI polish callback: receives the Markdown content and calls apply when done to write the result back to the editor */
        onPolish?(markdown: string, apply: (result: string) => void, options?: IAIPolishOptions): void;
        /** Fired when the user clicks cancel */
        onCancelPolish?(): void;
        /** Store a model's API key outside the webview; an empty key deletes it */
        onSetModelKey?(modelId: string, key: string): void;
    };

    /** Fired after the edit mode changes */
    changeEditMode?(value: string): void;

    /** Fired after focus  */
    focus?(value: string): void;

    /** Fired after blur */
    blur?(value: string): void;

    /** Fired after `esc` is pressed */
    esc?(value: string): void;

    /** Fired after `⌘/ctrl+enter` is pressed */
    ctrlEnter?(value: string): void;

    /** Fired after text is selected in the editor */
    select?(value: string): void;

    /** Fired when a link is opened with Ctrl/⌘+click, double-click or middle-click; falls back to the browser default when not set */
    onLinkClick?(payload: ILinkClickPayload, event: MouseEvent, vditor: IVditor): void;

    /** Fired after global settings change (only when config file sync is enabled) */
    onSettingsChange?(settings: ViewerSettingsExport): void;

    /** Fired when the edit config file button is clicked */
    onEditSettings?(): void;
}

interface IEChart {
    setOption(option: any): void;

    resize(): void;
}

interface IVditor {
    element: HTMLElement;
    options: IOptions;
    originalInnerHTML: string;
    lute: Lute | undefined;
    currentMode: IEditMode;
    /** Markdown character count at first load, used to compute the history debounce multiplier */
    documentInitialLength?: number;
    /** recordHistory multiplier relative to undoDelay; -1 means a very large document: debounce only, no forced flush */
    historyMaxWaitFactor?: number;
    outline: {
        element: HTMLElement,
        init(vditor: IVditor): void,
        render(vditor: IVditor): string,
        resetMobileDrawer(vditor: IVditor): void,
        restoreDesktopState(vditor: IVditor): void,
        toggle(vditor: IVditor, show?: boolean): void,
    };
    toolbar?: {
        elements?: { [key: string]: HTMLElement },
        element?: HTMLElement,
    };
    counter?: {
        element: HTMLElement
        render(vditor: IVditor, mdText?: string): void,
    };
    hint: {
        timeId: number
        element: HTMLDivElement
        recentLanguage: string
        fillEmoji?(element: HTMLElement, vditor: IVditor): void
        fillHint(element: HTMLElement, vditor: IVditor): void
        render(vditor: IVditor): void,
        genHTML(data: IHintData[], key: string, vditor: IVditor): void
        select(event: KeyboardEvent, vditor: IVditor): boolean,
    };
    tip: {
        element: HTMLElement
        show(text: string, time?: number): void
        hide(): void,
    };
    upload?: {
        element: HTMLElement
        isUploading: boolean
        range: Range,
    };
    undo?: {
        clearStack(vditor: IVditor): void,
        redo(vditor: IVditor): void
        undo(vditor: IVditor): void
        addToUndoStack(vditor: IVditor): void
        recordFirstPosition(vditor: IVditor, event: KeyboardEvent): void,
        resetIcon(vditor: IVditor): void,
    };
    wysiwyg?: {
        range: Range,
        element: HTMLPreElement,
        selectPopover?: HTMLDivElement,
        popover: HTMLDivElement,
        afterRenderTimeoutId: number,
        afterRenderLastAt: number,
        hlToolbarTimeoutId: number,
        preventInput: boolean,
        composingLock: boolean,
        unbindListener(): void,
    };
    ir?: {
        range: Range,
        element: HTMLPreElement,
        popover: HTMLDivElement,
        composingLock: boolean,
        preventInput: boolean,
        processTimeoutId: number,
        afterRenderLastAt: number,
        hlToolbarTimeoutId: number,
    };
}
