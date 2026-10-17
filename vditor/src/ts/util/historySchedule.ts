/** Debounce max-wait factor for medium-sized documents (relative to undoDelay), same as the original default behaviour */
export const DEFAULT_HISTORY_MAX_WAIT_FACTOR = 3;

/**
 * Very large document threshold: above it there is no max-wait factor, continuous typing only resets the undoDelay timer,
 * and recordHistory / save fire only once typing stops, never forced to flush by accumulated typing time.
 */
export const HISTORY_UNLIMITED_DEFER_LENGTH = 50_000;

/** getHistoryMaxWaitFactor return value: debounce only, no forced flush */
export const HISTORY_UNLIMITED_DEFER_FACTOR = -1;

/** Common Markdown document size tiers (character count, same as String.length) */
const LENGTH_SNIPPET = 800;       // notes, one-line memos
const LENGTH_SHORT = 2_500;       // short texts, daily reports
const LENGTH_README = 6_000;      // README, short blog posts
const LENGTH_ARTICLE = 12_000;    // technical articles
const LENGTH_CHAPTER = 20_000;    // long texts, documentation chapters
const LENGTH_LARGE_PAGE = 30_000; // large single pages, multiple sections combined

const HISTORY_MAX_WAIT_FACTOR_MIN = 1;
const HISTORY_MAX_WAIT_FACTOR_MAX = 5;

export const isUnlimitedHistoryDefer = (maxWaitFactor: number): boolean => {
    return maxWaitFactor === HISTORY_UNLIMITED_DEFER_FACTOR;
};

/**
 * Compute the debounce max-wait factor from the size of the initially loaded Markdown.
 * The larger the document, the higher the factor; at ≥50,000 characters only debounce, with no max-wait limit.
 */
export const computeHistoryMaxWaitFactor = (markdownLength: number): number => {
    if (markdownLength >= HISTORY_UNLIMITED_DEFER_LENGTH) {
        return HISTORY_UNLIMITED_DEFER_FACTOR;
    }
    if (markdownLength >= LENGTH_LARGE_PAGE) {
        return HISTORY_MAX_WAIT_FACTOR_MAX;
    }
    if (markdownLength >= LENGTH_CHAPTER) {
        return 4;
    }
    if (markdownLength >= LENGTH_ARTICLE) {
        return DEFAULT_HISTORY_MAX_WAIT_FACTOR;
    }
    if (markdownLength >= LENGTH_README) {
        return 3;
    }
    if (markdownLength >= LENGTH_SHORT) {
        return 2;
    }
    if (markdownLength >= LENGTH_SNIPPET) {
        return 2;
    }
    return HISTORY_MAX_WAIT_FACTOR_MIN;
};

export const configureHistoryDeferByDocumentLength = (vditor: IVditor, markdownLength: number) => {
    vditor.documentInitialLength = markdownLength;
    vditor.historyMaxWaitFactor = computeHistoryMaxWaitFactor(markdownLength);
};

export const getHistoryMaxWaitFactor = (vditor: IVditor): number => {
    if (vditor.historyMaxWaitFactor === undefined) {
        return DEFAULT_HISTORY_MAX_WAIT_FACTOR;
    }
    return vditor.historyMaxWaitFactor;
};

/**
 * Continuous typing keeps resetting the debounce.
 * Returns undoDelay while under the limit; returns 0 after maxWait to force a push onto the stack.
 * Very large documents (unlimited) always return undoDelay and rely only on typing stopping to trigger a save.
 */
export const getHistoryRecordWait = (
    lastRecordAt: number,
    undoDelay: number,
    maxWaitFactor: number = DEFAULT_HISTORY_MAX_WAIT_FACTOR,
): number => {
    if (isUnlimitedHistoryDefer(maxWaitFactor)) {
        return undoDelay;
    }
    if (maxWaitFactor <= 0) {
        return 0;
    }
    if (!lastRecordAt) {
        return undoDelay;
    }
    const maxWait = undoDelay * maxWaitFactor;
    return Date.now() - lastRecordAt >= maxWait ? 0 : undoDelay;
};
