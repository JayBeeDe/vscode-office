/** Whether a link destination must be wrapped in angle brackets to parse correctly in Markdown */
export const needsAngleBracketLinkDest = (dest: string): boolean => {
    for (let i = 0; i < dest.length; i++) {
        const code = dest.charCodeAt(i);
        if (code <= 0x20 || code === 0x7f) {
            return true;
        }
        const ch = dest[i];
        if (ch === "<" || ch === ">") {
            return true;
        }
    }
    return false;
};

/** Format a link address as the destination part of a Markdown link */
export const formatMarkdownLinkDest = (dest: string): string => {
    const trimmed = dest.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        return trimmed;
    }
    if (needsAngleBracketLinkDest(trimmed)) {
        return `<${trimmed}>`;
    }
    return trimmed;
};

/** Normalize link edit input, removing angle brackets typed by the user */
export const normalizeLinkDestInput = (dest: string): string => {
    const trimmed = dest.trim();
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
};
