/**
 * The Markdown the editor writes follows markdownlint's default rules
 * (https://github.com/DavidAnson/markdownlint), with the decisions taken for this editor:
 * - not applied: MD010 (hard tabs), MD013 (line length), MD024 (duplicate headings), MD053
 *   (unused reference definitions), MD059 (link text);
 * - MD025 (one top-level heading) and MD036 (emphasis as a heading) act while editing, in the
 *   toolbar and when the caret leaves a line;
 * - every other rule is fixed here.
 *
 * Lute writes the Markdown from the editor's DOM in its own fixed style, so the fixes run in three
 * steps: on the Markdown before Lute reads it (what Lute would lose), on the editor's DOM before
 * Lute writes it (the markers, the heading levels), and on Lute's Markdown (spacing, links).
 */

export interface LintFormatOptions {
    /** the file name, for a first heading (MD041) */
    fileName?: string;
    /** `#word` is an Obsidian tag, not a heading missing its space (MD018) */
    obsidianTags?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Protected regions: code blocks, front matter, math blocks, inline code. The text rules skip them.
// ---------------------------------------------------------------------------------------------

interface Line {
    text: string;
    /** inside a code block, math block or front matter: left as it is */
    code: boolean;
    /** the opening or closing fence of a code block */
    fence?: "open" | "close";
}

const FENCE_RE = /^( {0,3}(?:>\s?)*\s*)(`{3,}|~{3,})(.*)$/;

const splitLines = (markdown: string): Line[] => {
    const lines: Line[] = [];
    const source = markdown.split("\n");
    let index = 0;
    // front matter
    if (source[0] === "---") {
        const end = source.indexOf("---", 1);
        if (end > 0) {
            for (; index <= end; index++) {
                lines.push({ text: source[index], code: true });
            }
        }
    }
    let fence: { char: string; length: number } | null = null;
    let math = false;
    for (; index < source.length; index++) {
        const text = source[index];
        if (fence) {
            const match = FENCE_RE.exec(text);
            const closes = match && match[2][0] === fence.char && match[2].length >= fence.length && !match[3].trim();
            lines.push({ text, code: true, fence: closes ? "close" : undefined });
            if (closes) {
                fence = null;
            }
            continue;
        }
        if (math) {
            lines.push({ text, code: true });
            if (text.trim() === "$$") {
                math = false;
            }
            continue;
        }
        const match = FENCE_RE.exec(text);
        if (match && !(match[2][0] === "`" && match[3].includes("`"))) {
            fence = { char: match[2][0], length: match[2].length };
            lines.push({ text, code: true, fence: "open" });
            continue;
        }
        if (text.trim() === "$$") {
            math = true;
            lines.push({ text, code: true });
            continue;
        }
        lines.push({ text, code: false });
    }
    return lines;
};

const joinLines = (lines: Line[]) => lines.map((line) => line.text).join("\n");

/** Applies `fix` to the text outside inline code spans (`code`) and autolinks (<url>). */
const outsideInlineCode = (text: string, fix: (part: string) => string): string => {
    const parts = text.split(/(`+[^`]*?`+|<[a-z][a-z0-9+.-]*:[^>\s]*>)/i);
    return parts.map((part, i) => (i % 2 === 1 ? part : fix(part))).join("");
};

/** Applies `fix` to each text line outside code. */
const mapTextLines = (markdown: string, fix: (text: string, index: number, lines: Line[]) => string) => {
    const lines = splitLines(markdown);
    lines.forEach((line, index) => {
        if (!line.code) {
            line.text = fix(line.text, index, lines);
        }
    });
    return joinLines(lines);
};

const isBlank = (text: string) => !text.trim();

// ---------------------------------------------------------------------------------------------
// Step 1: before Lute reads the Markdown, what it would otherwise lose or misread
// ---------------------------------------------------------------------------------------------

const ATTRIBUTE_RE = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");

const attribute = (tag: string, name: string) => {
    const match = ATTRIBUTE_RE(name).exec(tag);
    return match ? (match[1] ?? match[2] ?? match[3] ?? "") : "";
};

const baseName = (path: string) => {
    const name = decodeURIComponentSafe(path.split(/[?#]/)[0].split("/").pop() || "");
    return name.replace(/\.[^.]+$/, "");
};

const decodeURIComponentSafe = (text: string) => {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
};

/**
 * MD033: inline HTML with a Markdown equivalent. `<br>` ends the paragraph (a blank line), the
 * other tags become their Markdown; other HTML (details, kbd, sup...) is kept.
 */
const convertInlineHtml = (markdown: string) => mapTextLines(markdown, (text) => outsideInlineCode(text, (part) => part
    .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = attribute(tag, "src");
        if (!src) {
            return tag;
        }
        const alt = attribute(tag, "alt") || baseName(src);
        return `![${alt}](${src})`;
    })
    .replace(/<a\b[^>]*\bhref\s*=[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner: string) => {
        const href = attribute(tag, "href");
        return href ? `[${inner.trim() || href}](${href})` : tag;
    })
    .replace(/<(strong|b)>([^<]*?)<\/\1>/gi, (_tag, _name, inner: string) => (inner.trim() ? `**${inner.trim()}**` : inner))
    .replace(/<(em|i)>([^<]*?)<\/\1>/gi, (_tag, _name, inner: string) => (inner.trim() ? `*${inner.trim()}*` : inner))
    // a line break: a new paragraph, the only break markdownlint and the editor both keep
    .replace(/\s*<br\s*\/?>\s*/gi, "\n\n")));

/** A hard line break (2 trailing spaces or a backslash) ends the paragraph too. */
const hardBreaksToParagraphs = (markdown: string) => {
    const lines = splitLines(markdown);
    for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        const next = lines[i + 1];
        if (line.code || next.code || isBlank(next.text) || isBlank(line.text)) {
            continue;
        }
        if (/\S( {2,}|\\)$/.test(line.text) && !/^\s*\|/.test(line.text)) {
            const prefix = /^(\s*(?:>\s?)+)/.exec(line.text)?.[1].trimEnd() ?? "";
            line.text = `${line.text.replace(/( +|\\)$/, "")}\n${prefix}`;
        }
    }
    return joinLines(lines).replace(/\n(\s*>)?\n/g, (match) => match);
};

/** MD056: every row of a table gets as many cells as its widest row; Lute drops the extra ones. */
const splitRow = (row: string) => {
    const cells: string[] = [];
    let current = "";
    let code = 0;
    for (let i = 0; i < row.length; i++) {
        const char = row[i];
        if (char === "\\" && i + 1 < row.length) {
            current += char + row[++i];
            continue;
        }
        if (char === "`") {
            code = code ? 0 : 1;
        }
        if (char === "|" && !code) {
            cells.push(current);
            current = "";
            continue;
        }
        current += char;
    }
    cells.push(current);
    if (/^\s*\|/.test(row)) {
        cells.shift();
    }
    if (/\|\s*$/.test(row) && !/\\\|\s*$/.test(row)) {
        cells.pop();
    }
    return cells.map((cell) => cell.trim());
};

const DELIMITER_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const padTables = (markdown: string) => {
    const lines = splitLines(markdown);
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].code || lines[i - 1].code || !DELIMITER_RE.test(lines[i].text) || !lines[i - 1].text.includes("|")) {
            continue;
        }
        const start = i - 1;
        let end = i + 1;
        while (end < lines.length && !lines[end].code && lines[end].text.includes("|") && !isBlank(lines[end].text)) {
            end++;
        }
        const rows = lines.slice(start, end).map((line, index) => (index === 1 ? null : splitRow(line.text)));
        const width = Math.max(...rows.map((cells) => cells?.length ?? 0), splitRow(lines[i].text).length);
        const delimiter = splitRow(lines[i].text);
        rows.forEach((cells, index) => {
            const line = lines[start + index];
            if (!cells) {
                while (delimiter.length < width) {
                    delimiter.push("---");
                }
                line.text = `| ${delimiter.join(" | ")} |`;
                return;
            }
            while (cells.length < width) {
                cells.push("");
            }
            line.text = `| ${cells.join(" | ")} |`;
        });
        i = end;
    }
    return joinLines(lines);
};

/**
 * Lute drops the space before the first inline element of a table cell (`x, \`code\``,
 * `see **bold**`, `a [link](u)`...): shown and written glued (`x,\`code\``). A zero-width space
 * after it keeps it; Lute uses that character itself and doesn't write it.
 */
const keepSpacesInTableCells = (markdown: string) => {
    const lines = splitLines(markdown);
    for (const line of lines) {
        if (line.code || !/^\s*\|.*\|\s*$/.test(line.text) || DELIMITER_RE.test(line.text)) {
            continue;
        }
        line.text = line.text.replace(/(\S) (?=`|\*|_(?=\S)|!?\[|\$|~~|==)/g, "$1 \u200b");
    }
    return joinLines(lines);
};

/**
 * Prepares the Markdown before Lute reads it: when the editor opens a file, and before the
 * formatted text is read back. Without it, Lute drops `<br>`, `<img>`, the extra table cells and
 * the space before the first inline element of a table cell.
 */
export const prepareMarkdown = (markdown: string) => {
    if (typeof markdown !== "string") {
        return markdown;
    }
    try {
        return keepSpacesInTableCells(padTables(hardBreaksToParagraphs(convertInlineHtml(markdown.replace(/\r\n?/g, "\n")))));
    } catch {
        return markdown;
    }
};

// ---------------------------------------------------------------------------------------------
// Step 2: the editor's DOM before Lute writes it
// ---------------------------------------------------------------------------------------------

const slugify = (text: string) => text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");

const titleFromFileName = (fileName: string) => baseName(fileName)
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\p{L}[\p{L}\p{M}'’]*/gu, (word) => word[0].toUpperCase() + word.slice(1));

const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";

const headingLevel = (heading: Element) => Number(heading.tagName[1]);

/** Replaces a heading with one of `level`, keeping its content and attributes. */
const setHeadingLevel = (heading: Element, level: number) => {
    if (headingLevel(heading) === level) {
        return heading;
    }
    const replacement = heading.ownerDocument.createElement(`h${level}`);
    for (const { name, value } of Array.from(heading.attributes)) {
        replacement.setAttribute(name, value);
    }
    while (heading.firstChild) {
        replacement.appendChild(heading.firstChild);
    }
    heading.replaceWith(replacement);
    // the IR mode's heading marker (`## `)
    const marker = replacement.querySelector(".vditor-ir__marker--heading");
    if (marker && /^#{1,6} $/.test(marker.textContent || "")) {
        marker.textContent = `${"#".repeat(level)} `;
    }
    return replacement;
};

/** The top-level blocks of the editor's DOM, in order. */
const topHeadings = (root: Element) => Array.from(root.querySelectorAll(HEADING_SELECTOR))
    .filter((heading) => !heading.closest("blockquote, li, table"));

const replaceWithCode = (element: Element, text: string) => {
    const code = element.ownerDocument.createElement("code");
    code.textContent = text;
    element.replaceWith(code);
};

/**
 * Normalises the WYSIWYG DOM Lute writes the Markdown from, its markers being attributes:
 * MD004 `-` bullets, MD029 lists numbered from 1, MD003 ATX headings, MD049/MD050 `*` and `**`,
 * MD048 backtick fences, MD001 heading levels, MD041 a first heading, MD040/MD046 a language for
 * every code block, MD042/MD051/MD052 dead links as inline code, MD045 image alt text.
 */
export const normalizeEditorDom = (root: Element, options: LintFormatOptions = {}) => {
    // MD004: every bullet is `-`
    for (const element of Array.from(root.querySelectorAll("ul[data-marker], ul > li[data-marker]"))) {
        if (/^[*+-]$/.test(element.getAttribute("data-marker") || "")) {
            element.setAttribute("data-marker", "-");
        }
    }
    // MD029: ordered lists numbered 1. 2. 3.
    for (const list of Array.from(root.querySelectorAll("ol:not([data-type='footnotes-defs-ol'])"))) {
        list.removeAttribute("start");
        const delimiter = (list.getAttribute("data-marker") || "1.").slice(-1) === ")" ? ")" : ".";
        list.setAttribute("data-marker", `1${delimiter}`);
        Array.from(list.children).filter((child) => child.tagName === "LI").forEach((item, index) => {
            item.setAttribute("data-marker", `${index + 1}${delimiter}`);
        });
    }
    // MD003: ATX headings (Lute writes setext ones when their `data-marker` is `=` or `-`)
    for (const heading of Array.from(root.querySelectorAll(HEADING_SELECTOR))) {
        if (/^[=-]$/.test(heading.getAttribute("data-marker") || "")) {
            heading.removeAttribute("data-marker");
        }
    }
    // MD049/MD050: `*` emphasis, `**` strong
    for (const element of Array.from(root.querySelectorAll("em[data-marker], strong[data-marker]"))) {
        element.setAttribute("data-marker", (element.getAttribute("data-marker") || "").replace(/_/g, "*"));
    }
    // MD041: the first block is a top-level heading
    const firstBlock = Array.from(root.children).find((child) => child.getAttribute("data-type") !== "yaml-front-matter");
    if (options.fileName && (!firstBlock || firstBlock.tagName !== "H1")) {
        const title = titleFromFileName(options.fileName);
        if (title) {
            const heading = root.ownerDocument.createElement("h1");
            heading.setAttribute("data-block", "0");
            heading.textContent = title;
            if (firstBlock) {
                firstBlock.before(heading);
            } else {
                root.appendChild(heading);
            }
        }
    }
    // MD001: a heading is at most one level below the previous one; its sub-headings follow
    let previous = 0;
    const shifts: { from: number; by: number }[] = [];
    for (const heading of topHeadings(root)) {
        const original = headingLevel(heading);
        while (shifts.length && original <= shifts[shifts.length - 1].from) {
            shifts.pop();
        }
        let level = original - shifts.reduce((sum, shift) => sum + shift.by, 0);
        if (previous && level > previous + 1) {
            shifts.push({ from: original, by: level - (previous + 1) });
            level = previous + 1;
        }
        level = Math.max(1, Math.min(6, level));
        setHeadingLevel(heading, level);
        previous = level;
    }
    // MD048/MD040/MD046: backtick fences naming a language (Lute writes indented code fenced)
    for (const block of Array.from(root.querySelectorAll("[data-type='code-block']"))) {
        const marker = block.getAttribute("data-marker") || "```";
        block.setAttribute("data-marker", "`".repeat(Math.max(3, marker.length)));
        for (const code of Array.from(block.querySelectorAll("pre > code"))) {
            if (!/\blanguage-\S/.test(code.className)) {
                code.classList.add("language-none");
            }
        }
    }
    // MD042/MD051/MD052: a link without a target, or to a missing anchor, becomes inline code
    const anchors = new Set(topHeadings(root).map((heading) => slugify(heading.textContent || "")));
    for (const link of Array.from(root.querySelectorAll("a[href]"))) {
        const href = (link.getAttribute("href") || "").trim();
        const text = (link.textContent || "").trim();
        if (!href || href === "#") {
            replaceWithCode(link, text);
        } else if (href.startsWith("#") && !/^#(?:\^|L\d)/.test(href)) {
            const fragment = decodeURIComponentSafe(href.slice(1)).toLowerCase();
            if (anchors.has(fragment)) {
                link.setAttribute("href", `#${fragment}`);
            } else if (!Array.from(root.querySelectorAll("[id], [name]")).some((element) => (
                element.getAttribute("id") === href.slice(1) || element.getAttribute("name") === href.slice(1)
            ))) {
                replaceWithCode(link, text);
            }
        }
    }
    // MD034: a link whose text is its URL is written <url> (Lute writes [url](url)): plain text here,
    // wrapped by step 3
    for (const link of Array.from(root.querySelectorAll("a[href]"))) {
        const href = link.getAttribute("href") || "";
        const text = link.textContent || "";
        if ((text === href || `mailto:${text}` === href) && /^(?:https?|ftp|mailto):/i.test(href) && !link.querySelector("*")) {
            link.replaceWith(link.ownerDocument.createTextNode(text));
        }
    }
    // MD045: an image without alt text takes its file name
    for (const image of Array.from(root.querySelectorAll("img[src]"))) {
        if (!(image.getAttribute("alt") || "").trim()) {
            image.setAttribute("alt", baseName(image.getAttribute("data-workspace-absolute-src") || image.getAttribute("src") || ""));
        }
    }
};

// ---------------------------------------------------------------------------------------------
// Step 3: Lute's Markdown
// ---------------------------------------------------------------------------------------------

const allPunctuationNoQuestion = /[.,;:!。，；：！]+$/;

/** MD018/MD019/MD020/MD021/MD023/MD026: `# Title`, at the line start, without final punctuation. */
const fixHeadingLines = (markdown: string, options: LintFormatOptions) => mapTextLines(markdown, (text, index, lines) => {
    const previous = index > 0 ? lines[index - 1] : undefined;
    const inParagraph = previous && !previous.code && !isBlank(previous.text) && !/^\s*#/.test(previous.text);
    // MD018: `#word` at a line start is a heading missing its space (unless it's a tag)
    if (!options.obsidianTags && !inParagraph && /^ {0,3}#{1,6}[^#\s]/.test(text) && !/^ {0,3}#{1,6}\d/.test(text)) {
        text = text.replace(/^( {0,3}#{1,6})/, "$1 ");
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/.exec(text) || /^ {0,3}(#{1,6})$/.exec(text);
    if (!heading) {
        return text;
    }
    let content = (heading[2] ?? "").replace(/[ \t]+#+$/, "").replace(/^#+$/, "").trim();
    // MD026: no final punctuation (an HTML entity or :emoji: excepted)
    if (!/&#?\w+;$/.test(content) && !/:\w+:$/.test(content)) {
        content = content.replace(allPunctuationNoQuestion, "").trimEnd();
    }
    return content ? `${heading[1]} ${content}` : heading[1];
});

/** MD027 one space after `>`, MD030 one space after a list marker. */
const fixMarkerSpacing = (markdown: string) => mapTextLines(markdown, (text) => text
    .replace(/^((?:\s*>)+) {2,}(?=\S)/, (_match, prefix: string) => `${prefix} `)
    .replace(/^(\s*(?:>\s?)*\s*)([-*+]|\d+[.)]) {2,}(?=\S)/, "$1$2 "));

/** MD011 reversed links, MD034 bare URLs, MD037/MD038/MD039 spaces inside markers. */
const fixInline = (markdown: string) => mapTextLines(markdown, (text) => {
    if (/^\s*\|/.test(text) && /\|\s*$/.test(text)) {
        // table rows: the cells only
    }
    let fixed = outsideInlineCode(text, (part) => part
        // MD011: (text)[url] is [text](url)
        .replace(/\(([^()\n]+)\)\[([^\[\]\n]+)\](?!\()/g, (match, label: string, target: string) => (
            /^(?:https?:|mailto:|www\.|\/|\.|#)/i.test(target) ? `[${label}](${target})` : match
        ))
        // MD039: no space inside link text
        .replace(/(!?)\[([ \t]+)?([^\[\]\n]*?)([ \t]+)?\](?=\()/g, (_match, bang: string, _a, label: string) => `${bang}[${label}]`)
        // MD034: bare URLs and e-mail addresses in angle brackets
        .replace(/(^|[\s(])((?:https?:\/\/|ftp:\/\/)[^\s<>()\[\]]*[^\s<>()\[\].,;:!?'"])/gi, (match, before: string, url: string, offset: number, whole: string) => {
            const previousChar = whole[offset + before.length - 1];
            return previousChar === "<" || /\]\($/.test(whole.slice(0, offset + before.length)) ? match : `${before}<${url}>`;
        })
        .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)(?=$|[\s),.;:!?])/g, (match, before: string, mail: string, offset: number, whole: string) => (
            /\]\($/.test(whole.slice(0, offset + before.length)) ? match : `${before}<${mail}>`
        )));
    // MD038: no spaces inside a code span (a space next to an inner backtick is needed)
    fixed = fixed.replace(/(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g, (match, ticks: string, inner: string) => {
        const trimmed = inner.trim();
        if (!trimmed || trimmed === inner || trimmed.startsWith("`") || trimmed.endsWith("`")) {
            return match;
        }
        return `${ticks}${trimmed}${ticks}`;
    });
    // MD037: no spaces inside emphasis markers, as markdownlint fixes it: markers of the same kind
    // standing alone (not glued to the word on both sides) are paired in order; the spaces on the
    // inner side of each pair are removed
    fixed = outsideInlineCode(fixed, (part) => {
        for (const marker of ["***", "**", "*", "___", "__", "_"]) {
            const escaped = marker.replace(/\*/g, "\\*");
            const re = new RegExp(`(?<![*_\\\\])${escaped}(?![*_])`, "g");
            const positions: number[] = [];
            let match: RegExpExecArray | null;
            while ((match = re.exec(part))) {
                const before = part[match.index - 1] ?? " ";
                const after = part[match.index + marker.length] ?? " ";
                // a marker with spaces on both sides, or one side, is a candidate
                if (/\s/.test(before) || /\s/.test(after)) {
                    positions.push(match.index);
                }
            }
            for (let i = positions.length - 2 - (positions.length % 2); i >= 0; i -= 2) {
                const open = positions[i];
                const close = positions[i + 1];
                let inner = part.slice(open + marker.length, close);
                const trimmed = inner.trim();
                if (!trimmed || trimmed === inner) {
                    continue;
                }
                inner = trimmed;
                part = part.slice(0, open + marker.length) + inner + part.slice(close);
            }
        }
        return part;
    });
    return fixed;
});

/** MD052: a reference `[text][label]`, `[label][]` or `[label]` with no `[label]: url` is inline code. */
const fixUndefinedReferences = (markdown: string) => {
    const lines = splitLines(markdown);
    const labels = new Set<string>();
    const normalize = (label: string) => label.trim().replace(/\s+/g, " ").toLowerCase();
    for (const line of lines) {
        const match = !line.code && /^ {0,3}\[([^\]]+)\]:\s*\S/.exec(line.text);
        if (match) {
            labels.add(normalize(match[1]));
        }
    }
    return mapTextLines(markdown, (text) => {
        if (/^ {0,3}\[[^\]]+\]:\s*\S/.test(text)) {
            return text;
        }
        return outsideInlineCode(text, (part) => part.replace(
            /(!?)(?<![\\\]\[])\[([^\[\]\n]+)\](?:\[([^\[\]\n]*)\])?(?![(:\[\]])/g,
            (match, bang: string, first: string, second: string | undefined) => {
                // [!note] callouts, [ ] / [x] task boxes, [^1] footnotes, [[wiki]] links
                if (bang || /^[!^ xX]/.test(first) || /^\s*$/.test(first)) {
                    return match;
                }
                const label = second ? second : first;
                if (labels.has(normalize(label))) {
                    return match;
                }
                // a lone [text] that isn't a reference to anything is just text in brackets for
                // CommonMark, but markdownlint reports it: inline code, as decided
                return `\`${first}\``;
            },
        ));
    });
};

/** MD009 trailing spaces, MD012 one blank line at most, MD047 one final newline. */
const fixWhitespace = (markdown: string) => {
    const lines = splitLines(markdown);
    const out: Line[] = [];
    for (const line of lines) {
        if (!line.code) {
            // a hard break (2 spaces) is not written: breaks are paragraphs (see step 1)
            line.text = line.text.replace(/\s+$/, "");
            if (isBlank(line.text) && out.length && !out[out.length - 1].code && isBlank(out[out.length - 1].text)) {
                continue;
            }
        }
        out.push(line);
    }
    while (out.length && !out[0].code && isBlank(out[0].text)) {
        out.shift();
    }
    while (out.length && !out[out.length - 1].code && isBlank(out[out.length - 1].text)) {
        out.pop();
    }
    return `${joinLines(out)}\n`;
};

/**
 * MD022 headings, MD031 code blocks, MD032 lists, MD058 tables: a blank line around each,
 * also inside a quote (with its `>`); MD028: a blank line inside a quote gets `>`.
 */
const fixBlankLinesAround = (markdown: string) => {
    const lines = splitLines(markdown);
    const quotePrefix = (text: string) => /^(\s*(?:>\s?)+)/.exec(text)?.[1].trimEnd() ?? "";
    const strip = (text: string) => text.replace(/^\s*(?:>\s?)+/, "");
    const kind = (line: Line | undefined): string => {
        if (!line) {
            return "none";
        }
        const text = strip(line.text);
        if (line.fence) {
            return line.fence === "open" ? "fence-open" : "fence-close";
        }
        if (line.code) {
            return "code";
        }
        if (isBlank(text)) {
            return "blank";
        }
        if (/^\s{0,3}#{1,6}(\s|$)/.test(text)) {
            return "heading";
        }
        if (/^\s*([-*+]|\d+[.)])(\s|$)/.test(text)) {
            return "list";
        }
        if (/^\s*\|/.test(text)) {
            return "table";
        }
        if (/^\s{2,}\S/.test(text)) {
            return "continuation";
        }
        return "text";
    };
    const out: Line[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const current = kind(line);
        const previous = out[out.length - 1];
        const previousKind = kind(previous);
        const sameQuote = previous && quotePrefix(previous.text) === quotePrefix(line.text);
        const needsBlank = previous && previousKind !== "blank" && sameQuote && (
            current === "heading" || previousKind === "heading" ||
            current === "fence-open" || previousKind === "fence-close" ||
            (current === "table") !== (previousKind === "table") ||
            (current === "list" && previousKind !== "list" && previousKind !== "continuation") ||
            ((previousKind === "list" || previousKind === "continuation") && current === "text" && !/^\s/.test(strip(line.text)))
        );
        if (needsBlank && !(previous?.code && !previous.fence && !previous.text.startsWith("$$") && previousKind === "code")) {
            const prefix = quotePrefix(line.text);
            out.push({ text: prefix, code: false });
        }
        // MD028: a blank line between two quotes becomes `>`
        if (current === "blank" && !line.code && previous && quotePrefix(previous.text)) {
            const next = lines[i + 1];
            if (next && quotePrefix(next.text)) {
                out.push({ text: quotePrefix(previous.text), code: false });
                continue;
            }
        }
        out.push(line);
    }
    return joinLines(out);
};

/** MD014: a shell block where every line starts with `$` and shows no output loses the `$`. */
const fixDollarCommands = (markdown: string) => {
    const lines = splitLines(markdown);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].fence !== "open") {
            continue;
        }
        let end = i + 1;
        while (end < lines.length && lines[end].fence !== "close") {
            end++;
        }
        const body = lines.slice(i + 1, end).filter((line) => !isBlank(line.text));
        if (body.length && body.every((line) => /^\s*\$\s+/.test(line.text))) {
            for (const line of body) {
                line.text = line.text.replace(/^(\s*)\$\s+/, "$1");
            }
        }
        i = end;
    }
    return joinLines(lines);
};

/** MD035: every horizontal rule is `---`. */
const fixHorizontalRules = (markdown: string) => mapTextLines(markdown, (text, index, lines) => {
    if (!/^ {0,3}([-*_])( *\1){2,} *$/.test(text)) {
        return text;
    }
    // `---` under a paragraph line is a setext heading, already turned into `##` in step 2
    const previous = lines[index - 1];
    if (/^ {0,3}-+ *$/.test(text) && previous && !previous.code && !isBlank(previous.text)) {
        return text;
    }
    return "---";
});

/** MD060: tables aligned, MD055: with leading and trailing pipes, MD056: same cell count. */
const alignTables = (markdown: string) => {
    const lines = splitLines(markdown);
    // the display width markdownlint measures: wide (CJK, emoji) characters count 2, marks 0
    const width = (text: string) => Array.from(text).reduce((sum, char) => {
        if (/[\p{Mn}\p{Me}\p{Cf}]/u.test(char)) {
            return sum;
        }
        const code = char.codePointAt(0) || 0;
        const wide = (code >= 0x1100 && code <= 0x115F) || (code >= 0x2E80 && code <= 0xA4CF) ||
            (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0xF900 && code <= 0xFAFF) ||
            (code >= 0xFE30 && code <= 0xFE4F) || (code >= 0xFF00 && code <= 0xFF60) ||
            (code >= 0xFFE0 && code <= 0xFFE6) || (code >= 0x1F300 && code <= 0x1FAFF) ||
            (code >= 0x20000 && code <= 0x3FFFD);
        return sum + (wide ? 2 : 1);
    }, 0);
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].code || lines[i - 1].code || !DELIMITER_RE.test(lines[i].text) || !lines[i - 1].text.includes("|")) {
            continue;
        }
        const start = i - 1;
        let end = i + 1;
        while (end < lines.length && !lines[end].code && lines[end].text.includes("|") && !isBlank(lines[end].text)) {
            end++;
        }
        const rows = lines.slice(start, end).map((line) => splitRow(line.text));
        const columns = Math.max(...rows.map((cells) => cells.length));
        const aligns = rows[1].map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "c" : cell.endsWith(":") ? "r" : cell.startsWith(":") ? "l" : ""));
        for (const cells of rows) {
            while (cells.length < columns) {
                cells.push("");
            }
        }
        const widths = Array.from({ length: columns }, (_, column) => Math.max(3, ...rows.map((cells, index) => (index === 1 ? 3 : width(cells[column])))));
        rows.forEach((cells, index) => {
            lines[start + index].text = `| ${cells.map((cell, column) => {
                if (index === 1) {
                    const align = aligns[column] || "";
                    const dashes = "-".repeat(widths[column] - (align === "c" ? 2 : align ? 1 : 0));
                    return align === "c" ? `:${dashes}:` : align === "r" ? `${dashes}:` : align === "l" ? `:${dashes}` : dashes;
                }
                return cell + " ".repeat(widths[column] - width(cell));
            }).join(" | ")} |`;
        });
        i = end;
    }
    return joinLines(lines);
};

/** Fixes Lute's Markdown (step 3). Never throws: on an error, the Markdown is returned as it is. */
export const formatMarkdownText = (markdown: string, options: LintFormatOptions = {}) => {
    if (typeof markdown !== "string") {
        return markdown;
    }
    try {
        let text = markdown.replace(/\r\n?/g, "\n");
        text = fixHeadingLines(text, options);
        text = fixHorizontalRules(text);
        text = fixMarkerSpacing(text);
        text = fixInline(text);
        text = fixUndefinedReferences(text);
        text = fixDollarCommands(text);
        text = alignTables(text);
        text = fixBlankLinesAround(text);
        text = fixWhitespace(text);
        return text;
    } catch {
        return markdown;
    }
};

/** The DOM toolkit the formatter parses the editor's HTML with: the page's, or linkedom in tests. */
export interface DomParserLike {
    parseFromString(html: string, type: "text/html"): Document;
}

/**
 * Formats Markdown to markdownlint's rules: Lute reads it as the WYSIWYG editor would, the DOM is
 * normalised, Lute writes it back, the text rules run; repeated until nothing changes (at most 3
 * times), so formatting the result again gives the same text. `lute` is a WYSIWYG Lute with the
 * editor's options; on an error, the Markdown is returned as it is.
 */
export const formatMarkdown = (markdown: string, lute: Lute, parser: DomParserLike, options: LintFormatOptions = {}) => {
    if (typeof markdown !== "string") {
        return markdown;
    }
    try {
        let text = markdown;
        for (let pass = 0; pass < 3; pass++) {
            const html = lute.Md2VditorDOM(prepareMarkdown(text));
            const doc = parser.parseFromString(`<!doctype html><html><body><div>${html}</div></body></html>`, "text/html");
            const root = doc.body.firstElementChild as Element;
            normalizeEditorDom(root, options);
            const next = formatMarkdownText(lute.VditorDOM2Md(root.innerHTML), options);
            if (next === text) {
                break;
            }
            text = next;
        }
        return text;
    } catch {
        return markdown;
    }
};
