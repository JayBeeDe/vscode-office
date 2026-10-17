# API Reference

Index: [[Home]]  
Terms: [[Reference/Glossary]]

#reference #api

## Authentication

Description of the authentication module. Clients must send a token. ^auth-section

```
Authorization: Bearer <token>
```

Jump to this block from [[Projects/Vditor]]: [[Reference/API#^auth-section]]

## Wikilink Parsing

Parses `[[path]]` and `[[path|alias]]`. ^api-wikilink

## Embeds

Parses `![[path]]` into an embed node. ^api-embed

## Callout

Parses `> [!TYPE] Title` into a callout block. ^api-callout

> [!CAUTION] Breaking change
> Changing the Lute Obsidian options may affect how existing documents render.

## Error Codes

| Code | Description |
| --- | --- |
| 400 | Invalid request |
| 401 | See [[Reference/API#^auth-section]] |

Error code table ^api-errors
