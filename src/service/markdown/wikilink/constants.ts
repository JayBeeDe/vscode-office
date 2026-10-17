export const WIKI_URI_PREFIX = 'wiki:';

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const;

/** Directories excluded from findFiles */
export const FIND_FILES_EXCLUDE = '**/{node_modules,.git}/**';

/** Maximum number of results for a single findFiles call */
export const FIND_FILES_LIMIT = 50;
