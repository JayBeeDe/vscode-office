# Translations

Every user-visible string of the extension lives here, one file per language. The extension
host and the webviews import these files through `src/i18n/index.ts`.

| Section | Used by | Placeholders filled by |
| --- | --- | --- |
| `host` | the extension host: notifications, dialogs, status bar | `i18n('markdown.exportStart', { type })` in `src/common/global.ts` |
| `viewer` | the React viewers: documents, presentations, EPUB, XMind, Parquet | `$t('parquet.totalRows', { count })` in `src/react/i18n/i18nConfig.ts` |
| `spreadsheet` | the spreadsheet editor | `t('findReplace.replacedCount', { count })` in `src/react/view/excel/excel_i18n.ts` |
| `markdown` | the markdown editor (Vditor), its context menu and AI dialogs | sent by the host; the Vditor scripts in `vditor/src/js/i18n` are generated at build |
| `pdf` | the PDF viewer: the extension's buttons and PDF.js's interface | injected by the host (`src/provider/pdfViewerStrings.ts`) |

## Rules

- `en.json` is complete and is the fallback: another language holds only what is translated,
  and a missing key shows the English text.
- Placeholders are named, `{count}`, never positional, and a translation uses the same ones
  as English.
- Lists (the spreadsheet's month and weekday names) keep the same length as in English.
- `pdf.viewer` keeps PDF.js's names: `previous.title` is the `title` of the element whose
  `data-l10n-id` is `previous` (a plain string is its text). A plural is a macro and one key per
  form, as in PDF.js: `find_match_count` is `{[ plural(total) ]}` and `find_match_count[one]`,
  `find_match_count[other]`... hold the texts; a language only needs the forms it uses.
- When upgrading PDF.js, compare its new `en-US/viewer.properties` with `pdf.viewer` in
  `en.json` (its `{{name}}` placeholders are written `{name}` here).

## Adding a language

1. Create `<language>.json`, named after the language code without region in lower case
   (`it`, `pl`...), with only the keys you translate. Every region uses it: `pt-BR` and
   `pt-PT` read `pt.json`, `zh-CN` and `zh-TW` read `zh.json`.
2. Import it in `LANGUAGES` in `src/i18n/index.ts`.
3. For the markdown editor's demo page only: add it to `VDITOR_LANGUAGES` in
   `vditor/vite.config.ts` when Vditor has a code for it.

## Checks

`npm run i18n:check` (`-- --verbose` to list the warnings) checks the files, the keys and the
placeholders against English, the keys the code uses, and hard-coded strings in plain JS and
host code, then prints the coverage of each language. The build and CI run it; errors fail
them. ESLint (`npm run lint`) reports hard-coded strings in the React views.

A line with `i18n-ignore` is skipped by the hard-coded string scan; in the React views, use
`eslint-disable-next-line` with a reason.
