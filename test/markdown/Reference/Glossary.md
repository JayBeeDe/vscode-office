# Glossary

[[Home]] · [[Reference/API]]

#glossary #reference

## WikiLink

Obsidian wikilink syntax: `[[Target page]]`, `[[path/page|alias]]`. ^term-wikilink

Examples: [[Projects/Vditor]], [[Notes/Meeting-Notes|Meeting notes]]

## Embed

Embed syntax: `![[page]]` shows the target page or resource embedded. ^term-embed

Example: ![[Projects/Roadmap]]

## Block ID

Write `^block-id` at the end of a block, and reference it elsewhere with `[[page#^block-id]]`. ^term-block-id

Sample block:

This is a sample paragraph with a block ID. ^sample-block

References: [[Reference/Glossary#^sample-block]], [[#^term-block-id]]

## Tag

Tags start with `#` and can be nested: `#a/b/c`. ^term-tag

Examples: #obsidian/test #project/vditor

## Callout

Blockquote extension: `> [!NOTE] Title`. ^term-callout

> [!NOTE] Example
> A callout body can contain [[Home]] and #inline-tag.

## Non-Obsidian Syntax (for Comparison)

- Standard link: [MDN](https://developer.mozilla.org)
- Inside code: `[[not-wikilink]]`
- URL: `https://example.com#fragment` (not a tag)
