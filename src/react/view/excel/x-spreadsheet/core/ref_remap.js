// Remapping of cell references when rows or columns are inserted, deleted or moved.
//
// An axis map is a function from an old row (or column) index to its new index, or null when
// that row (or column) is deleted.

import { indexAt, stringAt } from './alphabet';

/** Rows (or columns) from `at` move down by n. */
export const insertAxisMap = (at, n) => i => (i >= at ? i + n : i);

/** Rows (or columns) start..end are deleted. */
export const deleteAxisMap = (start, end) => {
  const n = end - start + 1;
  return (i) => {
    if (i < start) return i;
    if (i > end) return i - n;
    return null;
  };
};

/** From an old → new index table (moved rows or columns). */
export const remapAxisMap = remap => i => (remap[i] ?? i);

const identity = i => i;

/** New span of start..end: the first and last of its indexes that still exist. */
export function mapSpan(start, end, map) {
  const s = Math.min(start, end);
  const e = Math.max(start, end);
  let ns = null;
  for (let i = s; i <= e && ns === null; i += 1) ns = map(i);
  if (ns === null) return null;
  let ne = null;
  for (let i = e; i >= s && ne === null; i -= 1) ne = map(i);
  return ns <= ne ? [ns, ne] : [ne, ns];
}

/** New position of an anchor index: the index itself, or the first one after it that remains. */
export function mapAnchor(index, map, limit = index + 100000) {
  for (let i = index; i <= limit; i += 1) {
    const mapped = map(i);
    if (mapped !== null) return mapped;
  }
  return index;
}

const REF_RE = /^((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?::(\$?)([A-Za-z]{1,3})(\$?)(\d+))?/;

const sheetOfPrefix = (prefix) => {
  if (!prefix) return null;
  const name = prefix.slice(0, -1);
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;
};

/**
 * Rewrite the references of a formula.
 * @param {string} text formula, with its leading "="
 * @param {{ row?: Function, col?: Function }} maps axis maps
 * @param {(sheet: string|null) => boolean} appliesTo whether references to that sheet move
 *        (sheet is null for an unqualified reference)
 */
export function remapFormula(text, maps, appliesTo = sheet => sheet === null) {
  if (typeof text !== 'string' || text[0] !== '=') return text;
  const rowMap = maps.row || identity;
  const colMap = maps.col || identity;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      // string literal: copied as is
      const close = text.indexOf('"', i + 1);
      const end = close === -1 ? text.length : close + 1;
      out += text.slice(i, end);
      i = end;
      continue;
    }
    const prev = i > 0 ? text[i - 1] : '';
    const match = /[\w.$]/.test(prev) ? null : REF_RE.exec(text.slice(i));
    // not a reference when followed by a name character or "(" (a function such as LOG10()
    if (!match || /^[\w(]/.test(text.slice(i + match[0].length))) {
      out += c;
      i += 1;
      continue;
    }
    const [whole, prefix = '', ca1 = '', col1, ra1 = '', row1, ca2 = '', col2, ra2 = '', row2] = match;
    i += whole.length;
    if (!appliesTo(sheetOfPrefix(prefix))) {
      out += whole;
      continue;
    }
    const c1 = indexAt(col1.toUpperCase());
    const r1 = Number(row1) - 1;
    if (col2 === undefined) {
      const nc = colMap(c1);
      const nr = rowMap(r1);
      out += nc === null || nr === null ? `${prefix}#REF!` : `${prefix}${ca1}${stringAt(nc)}${ra1}${nr + 1}`;
      continue;
    }
    const cols = mapSpan(c1, indexAt(col2.toUpperCase()), colMap);
    const rows = mapSpan(r1, Number(row2) - 1, rowMap);
    if (!cols || !rows) {
      out += `${prefix}#REF!`;
      continue;
    }
    out += `${prefix}${ca1}${stringAt(cols[0])}${ra1}${rows[0] + 1}:${ca2}${stringAt(cols[1])}${ra2}${rows[1] + 1}`;
  }
  return out;
}

/** Remap a range written as "A1:B5" (or "A1"); null when all of it is deleted. */
export function remapRangeRef(ref, maps) {
  const remapped = remapFormula(`=${ref}`, maps).slice(1);
  return remapped.includes('#REF!') ? null : remapped;
}
