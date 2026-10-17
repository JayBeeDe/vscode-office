import { getMessages, Language } from '@/i18n';

type PdfViewerStrings = Record<string, string | Record<string, string>>;

const toJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The strings of the PDF viewer page, from the `pdf` section of i18n/<language>.json:
 * the extension's own buttons, and PDF.js's interface as the dictionary its l10n reads from
 * `<script type="application/l10n">`: `{ id: { textContent | title | ...: text } }`.
 */
export function getPdfViewerStrings(language: Language) {
    const { viewer, ...buttons } = getMessages(language).pdf;
    const dictionary: Record<string, Record<string, string>> = {};
    for (const [id, value] of Object.entries(viewer as PdfViewerStrings)) {
        const props = typeof value === 'string' ? { textContent: value } : value;
        // PDF.js fills in {{name}}: the JSON files use {name} like the rest of the extension
        dictionary[id] = Object.fromEntries(Object.entries(props).map(([prop, text]) => [prop, text.replace(/\{(\w+)\}/g, '{{$1}}')]));
    }
    return {
        buttons: toJson(buttons),
        // any locale PDF.js asks for falls back to default_locale
        l10n: toJson({ default_locale: language, locales: { [language]: dictionary } }),
    };
}
