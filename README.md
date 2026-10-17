# Office Viewer

## Introduction

This extension lets you preview and edit common office files directly in VS Code. The viewers follow your current VS Code color theme.

| Feature | Formats | Mode | Library behind it (version) | Technology |
| --- | --- | --- | --- | --- |
| Spreadsheet | `.xlsx`, `.xlsm`, `.xltx`, `.xltm`, `.xls`, `.xlt`, `.ods`, `.ots`, `.csv`, `.tsv` | Edit and save | [x-spreadsheet](https://github.com/myliang/x-spreadsheet) (modified copy in `src/react/view/excel/x-spreadsheet`) for the grid; [ExcelJS](https://github.com/exceljs/exceljs) 5.0.2 ([@cweijan/exceljs](https://www.npmjs.com/package/@cweijan/exceljs) fork) for the xlsx family, macros kept; [SheetJS](https://github.com/SheetJS/sheetjs) 0.18.5 for `.xls`, `.xlt`, `.ods`, `.ots`; [uDSV](https://github.com/leeoniya/uDSV) 0.5.3 and [iconv-lite](https://github.com/ashtuchkin/iconv-lite) 0.6.3 for CSV/TSV | React webview, canvas grid |
| Document | `.docx`, `.docm`, `.dotx`, `.dotm` | Edit and save | [docx-editor](https://github.com/eigenpal/docx-editor) 1.9.0 (`@eigenpal/docx-editor-react`) | React webview, ProseMirror |
| Presentation | `.pptx`, `.pptm`, `.ppsx`, `.potx`, `.ppsm`, `.potm` | Read-only | [pptxviewjs](https://www.npmjs.com/package/pptxviewjs) 1.1.9 | React webview, canvas |
| PDF | `.pdf` | Read-only | [PDF.js](https://github.com/mozilla/pdf.js) 3.1.81 (copy in `resource/pdf`) | Plain JavaScript webview, canvas |
| EPUB | `.epub` | Read-only | [epub.js](https://github.com/futurepress/epub.js) 0.3.93 | React webview, iframe |
| Mind map | `.xmind` | Edit and save | [Mind Elixir](https://github.com/SSShooter/mind-elixir-core) 5.15.1, [@mind-elixir/import-xmind](https://www.npmjs.com/package/@mind-elixir/import-xmind) 1.0.8 to read, [JSZip](https://github.com/Stuk/jszip) 3.10.2 to write | React webview, HTML and SVG |
| Parquet | `.parquet` | Edit cells and save | [hyparquet](https://github.com/hyparam/hyparquet) 1.31.3, [hyparquet-writer](https://github.com/hyparam/hyparquet-writer) 0.15.7 | React webview, Ant Design table |
| Markdown | `.md`, `.markdown` | Edit (WYSIWYG) and save; export to PDF, DOCX, HTML | [Vditor](https://github.com/Vanessa219/vditor) (modified copy in `vditor/`) with [Lute](https://github.com/88250/lute) and [CodeMirror](https://codemirror.net/) 6 for code blocks; exports: [markdown-it](https://github.com/markdown-it/markdown-it) 14.3.2, [Puppeteer](https://github.com/puppeteer/puppeteer) 25.13.0 (`puppeteer-core`, PDF), [vscode-html-to-docx](https://www.npmjs.com/package/vscode-html-to-docx) 1.1.3 (DOCX) | TypeScript webview (no framework) |

Notes:

- A read-only file (permissions, read-only file system) opens read-only in every viewer.
- The versions are those installed when this table was written; `package.json` has the exact ranges.
- The webviews are built with [React](https://react.dev/) 19 and [Ant Design](https://ant.design/) 5, except the PDF viewer and the Markdown editor.
- In the web extension (vscode.dev), Markdown export is not available.

## Markdown

This extension replaces the default Markdown editor with a WYSIWYG editor.

To use the built-in VS Code Markdown editor instead, add this to your `settings.json`:

```json
{
    "workbench.editorAssociations": {
        "*.md": "default",
        "*.markdown": "default"
    }
}
```

Right-click in the editor to export Markdown to PDF, DOCX, or HTML. PDF export requires Chromium; set the browser path with `vscode-office.chromiumPath`.

![Export Markdown](image/README-CN/1685418034035.png)

Shortcuts: Based on [shortcut.md](shortcut.md), plus:

- New line: `Ctrl+Enter` / `⌘ Enter`
- Hard line break: `Shift+Enter` / `⇧ Enter`
- Edit hyperlink: `Alt+Enter` / `^ Enter`
- Set CodeMirror language: `Alt+Enter` / `^ Enter`
- Edit in VS Code: `Ctrl Alt E` / `⌘ ^ E`
- Paste as plain text: `Ctrl+Shift+V` / `⌘ ⇧ V`

## Development Guide

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### Getting started

```bash
git clone https://github.com/cweijan/vscode-office.git
cd vscode-office
npm install
```

### Development

**Desktop extension** (full feature set):

```bash
npm run dev
```

Press `F5` in VS Code, or choose **Extension** from Run and Debug.

**Web extension** (office viewers and Markdown in the browser):

```bash
npm run dev:web
```

Choose **Extension (Web)** from Run and Debug.

### Build & package

```bash
npm run build    # production build
npm run package  # create .vsix
```

## Credits

The libraries behind each viewer are listed in the table in the [introduction](#introduction).

- File icons for `.parquet`, `.epub`: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
- File icons for spreadsheet, document, `.csv`/`.tsv`, `.pdf` and Markdown formats, and the presentation icon (adapted from the document icon): [jesseweed/seti-ui](https://github.com/jesseweed/seti-ui)
