import { getMessages, Language } from '@/i18n';

type PdfStringTree = { [key: string]: string | PdfStringTree };
type PdfDictionary = Record<string, Record<string, string>>;

const toJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Turns the `pdf` tree back into PDF.js's flat ids:
 * - the path joined with `_` is the id: find.match.count is find_match_count;
 * - `@title`, `@label`... are attributes of that id, `@text` its own text;
 * - `[one]`, `[other]`... are plural forms: find_match_count[one].
 * PDF.js fills in {{name}}: the JSON files use {name} like the rest of the extension.
 */
function toDictionary(tree: PdfStringTree, path: string[] = [], dictionary: PdfDictionary = {}): PdfDictionary {
    const set = (id: string, prop: string, text: string) => {
        (dictionary[id] ??= {})[prop] = text.replace(/\{(\w+)\}/g, '{{$1}}');
    };
    for (const [key, value] of Object.entries(tree)) {
        if (typeof value !== 'string') {
            toDictionary(value, [...path, key], dictionary);
        } else if (key.startsWith('@')) {
            set(path.join('_'), key === '@text' ? 'textContent' : key.slice(1), value);
        } else if (key.startsWith('[')) {
            set(path.join('_') + key, 'textContent', value);
        } else {
            set([...path, key].join('_'), 'textContent', value);
        }
    }
    return dictionary;
}

/**
 * The strings of the PDF viewer page, from the `pdf` section of i18n/<language>.json, which holds
 * both the extension's own buttons (read by main.js) and PDF.js's interface. PDF.js gets them as
 * the dictionary its l10n reads from `<script type="application/l10n">`:
 * `{ id: { textContent | title | ...: text } }`; the button ids are unknown to it.
 */
export function getPdfViewerStrings(language: Language) {
    const strings = getMessages(language).pdf as PdfStringTree;
    const dictionary = toDictionary(strings);
    // the buttons' tooltips show their shortcut (webViewerKeyDown in resource/pdf/viewer.js), like the
    // dark mode button; previous / next page have none: their keys only turn pages in page-fit
    for (const [id, shortcut] of Object.entries(PDF_BUTTON_SHORTCUTS)) {
        const entry = dictionary[id];
        if (entry?.title) entry.title = `${entry.title} (${shortcut})`; // i18n-ignore: the shortcut
    }
    return {
        buttons: toJson(strings),
        // any locale PDF.js asks for falls back to default_locale
        l10n: toJson({ default_locale: language, locales: { [language]: dictionary } }),
    };
}

/** PDF.js ids of the buttons whose title gets their shortcut, the same in every language */
const PDF_BUTTON_SHORTCUTS: Record<string, string> = {
    toggle_sidebar: 'F4',
    toggle_sidebar_notification: 'F4',
    findbar: 'Ctrl+F',
    cursor_text_select_tool: 'Ctrl+S',
    cursor_hand_tool: 'Ctrl+H',
    first_page: 'Home',
    last_page: 'End',
};
