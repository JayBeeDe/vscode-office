# Obsidian Test Vault

A multi-file Markdown test set that mimics an Obsidian vault, for manual testing of vscode-office / Vditor.

## Folder Structure

```
test/markdown/
├── README.md           ← this file
├── Home.md             ← start from this file
├── Callouts.md         ← callout tests
├── Projects/
│   ├── Vditor.md
│   └── Roadmap.md
├── Notes/
│   ├── Meeting-Notes.md
│   └── Daily-2026-06-24.md
└── Reference/
    ├── API.md
    └── Glossary.md
```

## Covered Syntax

| Syntax | Example | Main locations |
| --- | --- | --- |
| WikiLink | `[[Home]]`, `[[Projects/Vditor|alias]]` | Links between all files |
| Embed | `![[Notes/Meeting-Notes]]` | Home, Vditor, Callouts |
| Block ID | `^block-id` at the end of a paragraph | API, Glossary, Meeting-Notes |
| Block link | `[[page#^block-id]]`, `[[#^id]]` | Daily, Vditor, Glossary |
| Tag | `#obsidian/test` | Frontmatter and body of each file |
| Callout | `> [!NOTE]` and others | Callouts.md, each note |

## Suggested Test Steps

1. Open `Home.md` in the extension.
2. Open the files under `Projects/`, `Notes/` and `Reference/` one after another and check how wikilinks render.
3. Edit wikilinks, callouts and tags, save, and check that the Markdown source round-trips correctly.
4. Open `Callouts.md` and check the five built-in callout types and the custom types.
5. In `Reference/Glossary.md`, check same-page and cross-page block references such as `[[#^sample-block]]`.

## File Relationships (Overview)

```
Home ──┬── Projects/Vditor ── Reference/API
       │         │
       ├── Projects/Roadmap
       │
       ├── Notes/Meeting-Notes ── Notes/Daily-2026-06-24
       │
       ├── Reference/Glossary
       │
       └── Callouts.md
```
