---
title: Home
tags: [obsidian, test, hub]
---

# Test Vault Home

This is the entry point of the multi-file Obsidian syntax test vault. From this page you can jump to every sub-page to check **cross-file wikilinks**, **block references**, **embeds** and **callouts**.

## Quick Navigation

| Topic | Links |
| --- | --- |
| Projects | [[Projects/Vditor]], [[Projects/Roadmap]] |
| Notes | [[Notes/Meeting-Notes]], [[Notes/Daily-2026-06-24]] |
| Reference | [[Reference/API]], [[Reference/Glossary]] |
| Callout | [[Callouts]] |

## Wikilink Examples

- Without alias: [[Projects/Vditor]]
- With alias: [[Projects/Roadmap|Product roadmap]]
- Subpath: [[Reference/API#Authentication]]

## Embed Example

Whole-page embed:

![[Notes/Meeting-Notes]]

## Block Reference (Same File)

Jump to "To-do Summary" on this page: [[#^home-todos]]

Reference a term definition: [[Reference/Glossary#^term-wikilink]]

## Tags

Tags of this vault: #obsidian/test #status/active

> [!TIP] Testing tip
> Open several `.md` files under `test/markdown/` in VS Code and check that cross-file `[[links]]` are recognized and can be followed (if the extension supports it).

## To-do Summary

The paragraph below has a block ID, so other pages can reference it with `[[Home#^home-todos]]`:

- [ ] Check callout rendering
- [ ] Check wikilinks and embeds
- [ ] Check block references `^block-id` and `[[page#^id]]`
- [ ] Check tags #nested/tag

^home-todos
