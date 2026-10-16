# Office Viewer

## Introduction

This extension lets you preview and edit common office files directly in VS Code.

- Excel: `.xls`, `.xlt`, `.xlsx`, `.xlsm`, `.xltx`, `.xltm`, `.csv`, `.tsv`, `.ods`, `.ots`
- Word: `.docx`, `.docm`, `.dotx`, `.dotm`
- PowerPoint: `.pptx`, `.pptm`, `.ppsx`, `.potx`, `.ppsm`, `.potm`
- PDF & eBook: `.pdf`, `.epub`
- Mind maps: `.xmind`
- Parquet: `.parquet`
- Markdown: `.md`, `.markdown`

The viewers follow your current VS Code color theme.

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

## Other features

- Excel: preview and save `.xlsx`, `.xls`, `.xlt`, `.xlsm`, `.xltx`, `.xltm`, `.csv`, `.ods`, and `.ots` files
- XMind: edit and save mind maps
- Parquet: browse the schema, edit cells, and save

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

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX rendering:
  - [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs): XLSX parsing
  - [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet): XLSX rendering
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- Markdown: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- File icons for `.parquet`, `.epub`: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
- File icons for spreadsheet, document, `.csv`/`.tsv`, `.pdf` and Markdown formats, and the presentation icon (adapted from the document icon): [jesseweed/seti-ui](https://github.com/jesseweed/seti-ui)
