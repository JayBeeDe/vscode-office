# Shortcuts

`Ctrl` is `Cmd` on macOS unless a macOS key is given, and `Alt` is `Option`. The shortcuts of the
viewers are built in; only the two VS Code shortcuts at the top can be changed, in VS Code's
Keyboard Shortcuts editor.

## VS Code

| Shortcut | Where | Action |
| --- | --- | --- |
| `Ctrl+V` | Markdown file in the text editor (desktop) | Paste a clipboard image as a file and insert a link to it |
| `Ctrl+Alt+E` (macOS `Ctrl+Cmd+E`) | Markdown file in the text editor | Open the Markdown editor |

## Every viewer

| Shortcut | Action |
| --- | --- |
| `F12` | Open the webview developer tools |

## Markdown

### General

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save (the file is formatted on save) |
| `Ctrl+Alt+E` (macOS `Ctrl+Cmd+E`) | Edit in the VS Code text editor |
| `Ctrl+Alt+7` / `Ctrl+Alt+8` | WYSIWYG / instant rendering mode |
| `Ctrl+F` / `Ctrl+R` | Find / find and replace |
| `Enter` / `Shift+Enter` | In the find bar: next / previous match; in the replace field: replace / replace all |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+Shift+V` | Paste as plain text |
| `Escape` | Close the find bar, a popover or the image preview, or leave a code block |

### Formatting

| Shortcut | Action |
| --- | --- |
| `Ctrl+H` | Headings menu |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | Heading 1 to 6 |
| `Ctrl+=` / `Ctrl+-` | In a heading: bigger / smaller heading |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+D` | Bold / italic / strikethrough |
| `Ctrl+G` | Inline code |
| `Ctrl+K` | Link |
| `Ctrl+O` / `Ctrl+J` | Ordered list / task list |
| `Ctrl+Shift+J` | Tick or untick the task |
| `Ctrl+;` | Blockquote |
| `Ctrl+Shift+;` | In a blockquote: nested blockquote (WYSIWYG) |
| `Ctrl+Shift+U` | Code block |
| `Ctrl+M` | Table |
| `(`, `[` | The closing `)` or `]` is added |

### Blocks

| Shortcut | Action |
| --- | --- |
| `Ctrl+L` | Select the block |
| `Ctrl+Shift+K` | Delete the block |
| `Alt+Up` / `Alt+Down` | Move the block up / down (also `Ctrl+Alt+I` / `Ctrl+Alt+J` in WYSIWYG) |
| `Shift+Alt+Up` / `Shift+Alt+Down` | Copy the block up / down |
| `Ctrl+Enter` / `Ctrl+Shift+Enter` | Insert an empty block after / before |
| `Ctrl+Shift+X` | Remove the block, when its popover has a Remove button (WYSIWYG) |
| `Shift+Enter` | Line break |
| `Alt+Enter` | On a link, image, HTML or table cell: open its popover; on a code block: choose its language |
| `Tab` / `Shift+Tab` | In a list: indent / outdent |

### Tables

| Shortcut | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Next / previous cell |
| `Enter` | Line break in the cell |
| `Ctrl+Shift+F` / `Ctrl+=` | Insert a row above / below |
| `Ctrl+Shift+G` / `Ctrl+Shift+=` | Insert a column left / right |
| `Ctrl+-` / `Ctrl+Shift+-` | Delete the row / column |
| `Ctrl+Shift+L` / `Ctrl+Shift+C` / `Ctrl+Shift+R` | Align the column left / center / right |

Code blocks, math, HTML and front matter are edited with CodeMirror and its usual keys
(`Ctrl+/` to comment, `Ctrl+D` to select the next match...). On the last line of a code block,
`Ctrl+Enter` leaves it.

## Spreadsheet

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save (Save As for a read-only file) |
| `Ctrl+F` / `Ctrl+H` | Find / replace |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste |
| `Ctrl+Shift+V` / `Ctrl+Alt+V` | Paste values only / formatting only |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / italic / underline |
| `Ctrl+Alt+0` | Fit the column widths |
| `Ctrl+A` | Select all |
| Arrows, `Shift`+arrows | Move / extend the selection |
| `Tab` / `Enter` (with `Shift` backwards) | Commit and move right / down |
| `Shift+Space` | Select the row |
| `F2`, or typing | Edit the cell (typing replaces its content, `=` starts a formula) |
| `Alt+Enter` | Line break in the cell |
| `Delete` / `Backspace` | Clear the cells |
| `Escape` | Cancel the edit |
| `Ctrl`+wheel | Zoom |

The grid keys work after a click in the grid.

## Document

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / italic / underline |
| `Ctrl+=` / `Ctrl+Shift+=` | Subscript / superscript |
| `Ctrl+L` / `Ctrl+E` / `Ctrl+R` / `Ctrl+J` | Align left / center / right / justify |
| `Ctrl+K` | Hyperlink |
| `Ctrl+F` / `Ctrl+H` | Find / find and replace |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+Shift+V` | Paste as plain text |
| `Tab` / `Shift+Tab` | In a list: indent / outdent |
| `Shift+Enter` | Line break |

## Presentation

| Shortcut | Action |
| --- | --- |
| `Right`, `Down`, `PageDown` | Next slide |
| `Left`, `Up`, `PageUp` | Previous slide |
| `Ctrl`+wheel | Zoom |

## PDF

| Shortcut | Action |
| --- | --- |
| `Ctrl+L` | Dark / light pages |
| `Ctrl+F`, `Ctrl+G` / `Ctrl+Shift+G` | Find, next / previous match |
| `Ctrl++` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / default zoom |
| `Home` / `End`, `Ctrl+Up` / `Ctrl+Down` | First / last page |
| `PageUp` / `PageDown`, `P` / `N`, `K` / `J` | Previous / next page |
| `Ctrl+Alt+G` | Go to a page number |
| `S` / `H` | Text selection / hand tool |
| `R` / `Shift+R` | Rotate clockwise / counterclockwise |
| `F4` | Sidebar |
| `Ctrl+Alt+P` | Presentation mode |
| `Ctrl+P` / `Ctrl+S` | Print / download |

## EPUB

| Shortcut | Action |
| --- | --- |
| `Right` / `Left` | Next / previous page |
| `Ctrl+C` | Copy the selected text |

## Mind map

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save |
| `Tab` | New subtopic |
| `Enter` / `Shift+Enter` | New topic after / before |
| `Ctrl+Enter` | New parent topic |
| `Delete` | Delete the topics |
| `F2` | Edit the topic |
| `PageUp` / `PageDown`, `Alt+Up` / `Alt+Down` | Move the topic up / down |
| Arrows | Select the next topic |
| `Ctrl+Up` / `Ctrl+Left` / `Ctrl+Right` | Branches on both sides / left / right |
| `F1` | Center the map |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / 100% |
| `Ctrl+K` then `0`, `=`, `1`…`9` | Collapse all, expand all, expand to a level |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste topics |
| `Space`+drag | Move the map |

A read-only mind map keeps only `Space`+drag and `Ctrl`+wheel.

## Parquet

| Shortcut | Action |
| --- | --- |
| `Ctrl+S` | Save |
| `Enter` / `Escape` | Commit / cancel the cell edit |
