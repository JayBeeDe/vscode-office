import { extname } from 'path';
import { MARKDOWN_EXTENSIONS } from './constants';
import { normalizePage } from './parse';

/** Relative file names for a direct lookup in a given directory */
export function directFileNames(page: string): string[] {
    const base = normalizePage(page);
    const ext = extname(base).toLowerCase();
    if (ext && MARKDOWN_EXTENSIONS.includes(ext as typeof MARKDOWN_EXTENSIONS[number])) {
        return [base];
    }
    const names: string[] = [];
    // [[doc.pdf]] or ![[img.png]] names an attachment as it is
    if (ext) {
        names.push(base);
    }
    for (const suffix of MARKDOWN_EXTENSIONS) {
        names.push(`${base}${suffix}`);
    }
    return names;
}

/**
 * Glob matching a file name without case, like Obsidian; glob characters of the name ({}, [], *,
 * ?) match any character, the results are then compared with the exact name.
 */
export function nameToGlob(name: string): string {
    return Array.from(name).map((char) => {
        if (/[{}[\]*?!]/.test(char)) return '?';
        const lower = char.toLowerCase();
        const upper = char.toUpperCase();
        return lower !== upper ? `[${lower}${upper}]` : char;
    }).join('');
}

/** Glob patterns for a recursive search in the workspace (** prefix only, passed to findFiles) */
export function recursiveFindPatterns(page: string): string[] {
    const base = normalizePage(page);
    const ext = extname(base).toLowerCase();
    if (ext && MARKDOWN_EXTENSIONS.includes(ext as typeof MARKDOWN_EXTENSIONS[number])) {
        return [`**/${base}`];
    }
    const patterns: string[] = [];
    if (ext) {
        patterns.push(`**/${base}`);
    }
    for (const suffix of MARKDOWN_EXTENSIONS) {
        patterns.push(`**/${base}${suffix}`);
    }
    return patterns;
}
