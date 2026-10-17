/* global window */
export const cssPrefix = 'x-spreadsheet';
export const dpr = window.devicePixelRatio || 1;
/** Minimum number of viewport columns (A–X) */
export const MIN_VIEW_COLS = 24;
/** Minimum number of viewport rows */
export const MIN_VIEW_ROWS = 40;
export default {
  cssPrefix,
  dpr,
  MIN_VIEW_COLS,
  MIN_VIEW_ROWS,
};
