# Meeting Notes — 2026-06-20

Attendees: [[Home]] maintainer, [[Projects/Vditor]] owner  
Tags: #meeting #decision

## Agenda

### 1. Obsidian Test Vault Structure

Decided to use a multi-file layout under `test/markdown/`, which makes cross-page wikilinks easy to test.

Decision ^decision-vault

Use folders to mimic an Obsidian vault, one topic per file.

### 2. Block Reference Conventions

- Block ID format: `^kebab-case-id`
- Cross-page reference: `[[Notes/Meeting-Notes#^action-items]]`
- Same-page reference: `[[#^action-items]]`

### 3. Action Items

Action item list (for embedding and references from other pages):

1. Create the test document set
2. Cover every callout type
3. Record edge cases in [[Reference/Glossary]]

^action-items

> [!WARNING] Open question
> Whether clicking a block reference scrolls to the target block depends on the extension.

## Related Links

- [[Reference/API#^auth-section]]
- [[Notes/Daily-2026-06-24]]
- ![[Projects/Roadmap]]
