/* global document, navigator */

import Selector from './selector';
import Scroll from './scroll';
import History from './history';
import Clipboard from './clipboard';
import { formatTsvRows, parseTsvRows } from './clipboard_text';
import { formatHtmlClipboard, parseHtmlClipboard } from './clipboard_html';
import AutoFilter from './auto_filter';
import { Merges } from './merge';
import helper from './helper';
import { MIN_VIEW_COLS, MIN_VIEW_ROWS } from '../config';
import { Rows } from './row';
import { Cols } from './col';
import { Validations } from './validation';
import { CellRange } from './cell_range';
import { expr2xy, xy2expr } from './alphabet';
import {
  deleteAxisMap, insertAxisMap, mapAnchor, remapAxisMap, remapFormula, remapRangeRef,
} from './ref_remap';
import { t } from '../locale/locale';
import { baseFonts } from './font';

// private methods
/*
 * {
 *  name: ''
 *  freeze: [0, 0],
 *  formats: [],
 *  styles: [
 *    {
 *      bgcolor: '',
 *      align: '',
 *      valign: '',
 *      textwrap: false,
 *      strike: false,
 *      underline: false,
 *      color: '',
 *      format: 1,
 *      border: {
 *        left: [style, color],
 *        right: [style, color],
 *        top: [style, color],
 *        bottom: [style, color],
 *      },
 *      font: {
 *        name: 'Helvetica',
 *        size: 10,
 *        bold: false,
 *        italic: false,
 *      }
 *    }
 *  ],
 *  merges: [
 *    'A1:F11',
 *    ...
 *  ],
 *  rows: {
 *    1: {
 *      height: 50,
 *      style: 1,
 *      cells: {
 *        1: {
 *          style: 2,
 *          type: 'string',
 *          text: '',
 *          value: '', // cal result
 *        }
 *      }
 *    },
 *    ...
 *  },
 *  cols: {
 *    2: { width: 100, style: 1 }
 *  }
 * }
 */
function getDefaultFontName() {
  return baseFonts[0].key;
}

const defaultSettings = {
  mode: 'edit', // edit | read
  view: {
    height: () => document.documentElement.clientHeight,
    width: () => document.documentElement.clientWidth,
  },
  showGrid: true,
  showToolbar: true,
  showContextmenu: true,
  showBottomBar: true,
  row: {
    len: MIN_VIEW_ROWS,
    height: 25,
  },
  col: {
    len: MIN_VIEW_COLS,
    width: 100,
    indexWidth: 60,
    minWidth: 60,
  },
  style: {
    bgcolor: '#ffffff',
    align: 'left',
    valign: 'middle',
    textwrap: false,
    strike: false,
    underline: false,
    color: '#0a0a0a',
    font: {
      name: getDefaultFontName(),
      size: 11,
      bold: false,
      italic: false,
    },
    format: 'normal',
  },
};

const toolbarHeight = 41;
const formulaBarHeight = 36;
const bottombarHeight = 41;
const MIN_ZOOM_SCALE = 0.5;
const MAX_ZOOM_SCALE = 2;

function syncCellMergesFromRanges() {
  const { rows, cols, merges } = this;
  rows.each((ri) => {
    rows.eachCells(ri, (ci, cell) => {
      if (cell && cell.merge) delete cell.merge;
    });
  });
  merges.forEach((cellRange) => {
    const {
      sri, sci, eri, eci,
    } = cellRange;
    if (sri === eri && sci === eci) return;
    const cell = rows.getCellOrNew(sri, sci);
    cell.merge = [eri - sri, eci - sci];
    rows.len = Math.max(rows.len, eri + 1);
    cols.len = Math.max(cols.len, eci + 1);
  });
}

function applyFontStyleAttr(cstyle, property, value) {
  const font = Object.assign({}, cstyle.font || {});
  if (property === 'font-bold') {
    font.bold = value;
  } else if (property === 'font-italic') {
    font.italic = value;
  } else if (property === 'font-name') {
    font.name = value;
  } else if (property === 'font-size') {
    font.size = value;
  }
  cstyle.font = font;
}

function getCellSortText(rows, ri, ci) {
  const cell = rows.getCell(ri, ci);
  return cell && cell.text != null ? `${cell.text}` : '';
}

function compareSortCellText(aText, bText, order = 'asc') {
  if (aText === bText) return 0;

  const aEmpty = aText.trim() === '';
  const bEmpty = bText.trim() === '';
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0;
    return aEmpty ? 1 : -1;
  }

  const aNum = Number(aText);
  const bNum = Number(bText);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) {
    return order === 'desc' ? bNum - aNum : aNum - bNum;
  }

  const result = aText.localeCompare(bText, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  return order === 'desc' ? -result : result;
}

// getData leaves out empty hyperlinks, images and protection; a snapshot taken before the
// first one was added must still clear it when it is restored
function withEmptyOptionalKeys(d) {
  return {
    hyperlinks: {},
    images: [],
    backgroundImage: null,
    sheetProtection: null,
    ...d,
  };
}

function getDataRowIndex(dataProxy, ri) {
  if (ri < 0) return ri;
  if (dataProxy.sortedRowMap.has(ri)) {
    return dataProxy.sortedRowMap.get(ri);
  }
  return ri;
}

// src: cellRange
// dst: cellRange
function canPaste(src, dst, error = () => {}) {
  const { merges } = this;
  const cellRange = dst.clone();
  const [srn, scn] = src.size();
  const [drn, dcn] = dst.size();
  if (srn > drn) {
    cellRange.eri = dst.sri + srn - 1;
  }
  if (scn > dcn) {
    cellRange.eci = dst.sci + scn - 1;
  }
  if (merges.intersects(cellRange)) {
    error(t('error.pasteForMergedCell'));
    return false;
  }
  return true;
}
function copyPaste(srcCellRange, dstCellRange, what, autofill = false) {
  const { rows, merges } = this;
  const mapRow = (ri) => getDataRowIndex(this, ri);
  // delete dest merge
  if (what === 'all' || what === 'format') {
    rows.deleteCells(dstCellRange, what, mapRow);
    merges.deleteWithin(dstCellRange);
  }
  rows.copyPaste(srcCellRange, dstCellRange, what, autofill, (ri, ci, cell) => {
    if (cell && cell.merge) {
      // console.log('cell:', ri, ci, cell);
      const [rn, cn] = cell.merge;
      if (rn <= 0 && cn <= 0) return;
      merges.add(new CellRange(ri, ci, ri + rn, ci + cn));
    }
  }, mapRow);
}

function cutPaste(srcCellRange, dstCellRange) {
  const mapRow = (ri) => getDataRowIndex(this, ri);
  const { clipboard, rows, merges } = this;
  rows.cutPaste(srcCellRange, dstCellRange, mapRow);
  merges.move(srcCellRange,
    dstCellRange.sri - srcCellRange.sri,
    dstCellRange.sci - srcCellRange.sci);
  clipboard.clear();
}

// bss: { top, bottom, left, right }
function setStyleBorder(ri, ci, bss) {
  const { styles, rows } = this;
  const cell = rows.getCellOrNew(getDataRowIndex(this, ri), ci);
  let cstyle = {};
  if (cell.style !== undefined) {
    cstyle = helper.cloneDeep(styles[cell.style]);
  }
  cstyle = helper.merge(cstyle, { border: bss });
  cell.style = this.addStyle(cstyle);
}

function setStyleBorders({ mode, style, color }) {
  const { styles, selector, rows } = this;
  const {
    sri, sci, eri, eci,
  } = selector.range;
  const multiple = !this.isSingleSelected();
  if (!multiple) {
    if (mode === 'inside' || mode === 'horizontal' || mode === 'vertical') {
      return;
    }
  }
  if (mode === 'outside' && !multiple) {
    setStyleBorder.call(this, sri, sci, {
      top: [style, color], bottom: [style, color], left: [style, color], right: [style, color],
    });
  } else if (mode === 'none') {
    selector.range.each((ri, ci) => {
      const cell = rows.getCell(getDataRowIndex(this, ri), ci);
      if (cell && cell.style !== undefined) {
        const ns = helper.cloneDeep(styles[cell.style]);
        delete ns.border;
        // ['bottom', 'top', 'left', 'right'].forEach((prop) => {
        //   if (ns[prop]) delete ns[prop];
        // });
        cell.style = this.addStyle(ns);
      }
    });
  } else if (mode === 'all' || mode === 'inside' || mode === 'outside'
    || mode === 'horizontal' || mode === 'vertical') {
    const merges = [];
    for (let ri = sri; ri <= eri; ri += 1) {
      for (let ci = sci; ci <= eci; ci += 1) {
        // jump merges -- start
        const mergeIndexes = [];
        for (let ii = 0; ii < merges.length; ii += 1) {
          const [mri, mci, rn, cn] = merges[ii];
          if (ri === mri + rn + 1) mergeIndexes.push(ii);
          if (mri <= ri && ri <= mri + rn) {
            if (ci === mci) {
              ci += cn + 1;
              break;
            }
          }
        }
        mergeIndexes.forEach(it => merges.splice(it, 1));
        if (ci > eci) break;
        // jump merges -- end
        const cell = rows.getCell(getDataRowIndex(this, ri), ci);
        let [rn, cn] = [0, 0];
        if (cell && cell.merge) {
          [rn, cn] = cell.merge;
          merges.push([ri, ci, rn, cn]);
        }
        const mrl = rn > 0 && ri + rn === eri;
        const mcl = cn > 0 && ci + cn === eci;
        let bss = {};
        if (mode === 'all') {
          bss = {
            bottom: [style, color],
            top: [style, color],
            left: [style, color],
            right: [style, color],
          };
        } else if (mode === 'inside') {
          if (!mcl && ci < eci) bss.right = [style, color];
          if (!mrl && ri < eri) bss.bottom = [style, color];
        } else if (mode === 'horizontal') {
          if (!mrl && ri < eri) bss.bottom = [style, color];
        } else if (mode === 'vertical') {
          if (!mcl && ci < eci) bss.right = [style, color];
        } else if (mode === 'outside' && multiple) {
          if (sri === ri) bss.top = [style, color];
          if (mrl || eri === ri) bss.bottom = [style, color];
          if (sci === ci) bss.left = [style, color];
          if (mcl || eci === ci) bss.right = [style, color];
        }
        if (Object.keys(bss).length > 0) {
          setStyleBorder.call(this, ri, ci, bss);
        }
        ci += cn;
      }
    }
  } else if (mode === 'top' || mode === 'bottom') {
    for (let ci = sci; ci <= eci; ci += 1) {
      if (mode === 'top') {
        setStyleBorder.call(this, sri, ci, { top: [style, color] });
        ci += rows.getCellMerge(sri, ci)[1];
      }
      if (mode === 'bottom') {
        setStyleBorder.call(this, eri, ci, { bottom: [style, color] });
        ci += rows.getCellMerge(eri, ci)[1];
      }
    }
  } else if (mode === 'left' || mode === 'right') {
    for (let ri = sri; ri <= eri; ri += 1) {
      if (mode === 'left') {
        setStyleBorder.call(this, ri, sci, { left: [style, color] });
        ri += rows.getCellMerge(ri, sci)[0];
      }
      if (mode === 'right') {
        setStyleBorder.call(this, ri, eci, { right: [style, color] });
        ri += rows.getCellMerge(ri, eci)[0];
      }
    }
  }
}

function getScrollRowIndex(y) {
  const { rows, exceptRowSet, freeze } = this;
  const [fri] = freeze;
  const [ri, top] = helper.rangeReduceIf(fri, rows.len, 0, 0, y, (i) => {
    if (exceptRowSet.has(i)) return 0;
    return rows.getHeight(i);
  });
  if (ri <= fri) return fri;
  return top < y ? ri - 1 : Math.max(fri, ri - 1);
}

function getScrollColIndex(x) {
  const { cols, freeze } = this;
  const [, fci] = freeze;
  const [ci, left] = helper.rangeReduceIf(fci, cols.len, 0, 0, x, i => cols.getWidth(i));
  if (ci <= fci) return fci;
  return left < x ? ci - 1 : Math.max(fci, ci - 1);
}

function getCellRowByY(y, scrollOffsety) {
  const { rows } = this;
  const fsh = this.freezeTotalHeight();
  // console.log('y:', y, ', fsh:', fsh);
  let inits = rows.height;
  if (fsh + rows.height < y) inits -= scrollOffsety;

  // handle ri in autofilter
  const frset = this.exceptRowSet;

  let ri = 0;
  let top = inits;
  let { height } = rows;
  for (; ri < rows.len; ri += 1) {
    if (top > y) break;
    if (!frset.has(ri)) {
      height = rows.getHeight(ri);
      top += height;
    }
  }
  top -= height;
  // console.log('ri:', ri, ', top:', top, ', height:', height);

  if (top <= 0) {
    return { ri: -1, top: 0, height };
  }

  return { ri: ri - 1, top, height };
}

function getCellColByX(x, scrollOffsetx) {
  const { cols } = this;
  const fsw = this.freezeTotalWidth();
  let inits = cols.indexWidth;
  if (fsw + cols.indexWidth < x) inits -= scrollOffsetx;
  const [ci, left, width] = helper.rangeReduceIf(
    0,
    cols.len,
    inits,
    cols.indexWidth,
    x,
    i => cols.getWidth(i),
  );
  if (left <= 0) {
    return { ci: -1, left: 0, width: cols.indexWidth };
  }
  return { ci: ci - 1, left, width };
}

export default class DataProxy {
  constructor(name, settings) {
    this.settings = helper.merge(defaultSettings, settings || {});
    // save data begin
    this.name = name || 'sheet';
    this.freeze = [0, 0];
    this.styles = []; // Array<Style>
    this.merges = new Merges(); // [CellRange, ...]
    this.rows = new Rows(this.settings.row);
    this.cols = new Cols(this.settings.col);
    this.validations = new Validations();
    this.hyperlinks = {};
    this.images = [];
    this.backgroundImage = null;
    this.sheetProtection = null;
    this.comments = {};
    // save data end

    // don't save object
    this.selector = new Selector();
    this.scroll = new Scroll();
    this.history = new History();
    this.clipboard = new Clipboard();
    this.autoFilter = new AutoFilter();
    this.change = () => {};
    this.exceptRowSet = new Set();
    this.sortedRowMap = new Map();
    this.unsortedRowMap = new Map();
    this.zoomScale = 1;
    this.rows.setZoomScale(this.zoomScale);
    this.cols.setZoomScale(this.zoomScale);
  }

  addValidation(mode, ref, validator) {
    // console.log('mode:', mode, ', ref:', ref, ', validator:', validator);
    this.changeData(() => {
      this.validations.add(mode, ref, validator);
      this.revalidateAll();
    });
  }

  removeValidation() {
    const { range } = this.selector;
    this.changeData(() => {
      this.validations.remove(range);
    });
  }

  getSelectedValidator() {
    const { ri, ci } = this.selector;
    const v = this.validations.get(ri, ci);
    return v ? v.validator : null;
  }

  getSelectedValidation() {
    const { ri, ci, range } = this.selector;
    const v = this.validations.get(ri, ci);
    const ret = { ref: range.toString() };
    if (v !== null) {
      ret.mode = v.mode;
      ret.validator = v.validator;
    }
    return ret;
  }

  // ri is a view row: hyperlinks are stored by data row, so they follow their record under a sort
  getHyperlink(ri, ci) {
    return this.hyperlinks[`${getDataRowIndex(this, ri)}_${ci}`] || null;
  }

  getSelectedHyperlink() {
    const { ri, ci } = this.selector;
    return this.getHyperlink(ri, ci);
  }

  setHyperlink(ri, ci, link, tooltip) {
    const key = `${getDataRowIndex(this, ri)}_${ci}`;
    this.changeData(() => {
      if (!link) {
        delete this.hyperlinks[key];
      } else {
        this.hyperlinks[key] = { link, tooltip };
      }
    });
  }

  setSelectedHyperlink(link, tooltip) {
    const { ri, ci } = this.selector;
    this.setHyperlink(ri, ci, link, tooltip);
  }

  removeSelectedHyperlink() {
    const { ri, ci } = this.selector;
    this.setHyperlink(ri, ci, '');
  }

  /**
   * After rows or columns were inserted, deleted or moved: update every reference to them
   * (formulas of all sheets, hyperlinks, images, validations, autofilter, freeze).
   * maps: { row?: axisMap, col?: axisMap }, see ref_remap.js
   */
  remapReferences(maps) {
    const rowMap = maps.row || (i => i);
    const colMap = maps.col || (i => i);
    const ownName = String(this.name || '').toLowerCase();
    const remapCells = (sheet, appliesTo) => {
      sheet.rows.each((ri) => {
        sheet.rows.eachCells(ri, (ci, cell) => {
          if (cell && typeof cell.text === 'string' && cell.text[0] === '=') {
            const next = remapFormula(cell.text, maps, appliesTo);
            if (next !== cell.text) {
              cell.text = next;
              delete cell.cached;
            }
          }
        });
      });
    };
    remapCells(this, sheet => sheet === null || sheet.toLowerCase() === ownName);
    // formulas of the other sheets that point to this one
    const others = (this.getAllSheets && this.getAllSheets()) || [];
    others.forEach((other) => {
      if (other !== this) remapCells(other, sheet => sheet !== null && sheet.toLowerCase() === ownName);
    });

    if (this.hyperlinks && Object.keys(this.hyperlinks).length) {
      const next = {};
      Object.keys(this.hyperlinks).forEach((key) => {
        const [ri, ci] = key.split('_').map(Number);
        const nri = rowMap(ri);
        const nci = colMap(ci);
        if (nri !== null && nci !== null) next[`${nri}_${nci}`] = this.hyperlinks[key];
      });
      this.hyperlinks = next;
    }

    (this.images || []).forEach((image) => {
      const { anchor } = image;
      const moveAxis = (value, map) => {
        if (value == null) return value;
        const base = Math.floor(value);
        return mapAnchor(base, map) + (value - base);
      };
      anchor.row = moveAxis(anchor.row, rowMap);
      anchor.col = moveAxis(anchor.col, colMap);
      if (anchor.brRow != null) anchor.brRow = moveAxis(anchor.brRow, rowMap);
      if (anchor.brCol != null) anchor.brCol = moveAxis(anchor.brCol, colMap);
    });

    this.validations._ = this.validations._.filter((validation) => {
      const v = validation;
      v.refs = v.refs.map(ref => remapRangeRef(ref, maps)).filter(Boolean);
      return v.refs.length > 0;
    });

    const { autoFilter } = this;
    if (autoFilter.active()) {
      const ref = remapRangeRef(autoFilter.ref, maps);
      if (!ref) {
        autoFilter.clear();
      } else {
        autoFilter.ref = ref;
        autoFilter.filters = autoFilter.filters.filter((filter) => {
          const f = filter;
          const ci = colMap(f.ci);
          if (ci === null) return false;
          f.ci = ci;
          return true;
        });
        if (autoFilter.sort) {
          const ci = colMap(autoFilter.sort.ci);
          if (ci === null) autoFilter.sort = null;
          else autoFilter.sort.ci = ci;
        }
      }
    }

    // freeze: [rows, cols] frozen; the last frozen row (or column) keeps its place
    const [fr, fc] = this.freeze;
    const lastKept = (count, map) => {
      for (let i = count - 1; i >= 0; i -= 1) {
        const mapped = map(i);
        if (mapped !== null) return mapped + 1;
      }
      return 0;
    };
    this.freeze = [fr > 0 ? lastKept(fr, rowMap) : fr, fc > 0 ? lastKept(fc, colMap) : fc];
  }

  remapMerges(rowRemap, colRemap) {
    // a merge that straddles the moved block covers the new places of all its rows (or
    // columns), so it is never inverted
    const span = (start, end, remap) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = start; i <= end; i += 1) {
        const mapped = remap[i] ?? i;
        if (mapped < min) min = mapped;
        if (mapped > max) max = mapped;
      }
      return [min, max];
    };
    this.merges.forEach((range) => {
      const cr = range;
      if (rowRemap) [cr.sri, cr.eri] = span(cr.sri, cr.eri, rowRemap);
      if (colRemap) [cr.sci, cr.eci] = span(cr.sci, cr.eci, colRemap);
    });
    syncCellMergesFromRanges.call(this);
  }

  moveRows(sri, eri, insertAt) {
    this.changeData(() => {
      const rowRemap = this.rows.moveRange(sri, eri, insertAt);
      if (!rowRemap) return;
      this.remapMerges(rowRemap, null);
      this.remapReferences({ row: remapAxisMap(rowRemap) });
      const { selector } = this;
      if (selector.ri >= 0) {
        selector.ri = rowRemap[selector.ri] ?? selector.ri;
      }
      const { sri: sr, sci, eri: er, eci } = selector.range;
      selector.range = new CellRange(
        rowRemap[sr] ?? sr,
        sci,
        rowRemap[er] ?? er,
        eci,
      );
      selector.moveIndexes = [selector.ri, selector.ci];
    });
  }

  moveColumns(sci, eci, insertAt) {
    this.changeData(() => {
      const { cols, rows } = this;
      const built = helper.buildIndexRemap(cols.len, sci, eci, insertAt);
      if (!built) return;
      const { remap: colRemap } = built;
      rows.each((ri, row) => {
        if (!row.cells) return;
        const ncells = {};
        for (const ci of Object.keys(row.cells)) {
          const oldCi = parseInt(ci, 10);
          const newCi = colRemap[oldCi];
          if (newCi !== undefined) ncells[newCi] = row.cells[ci];
        }
        row.cells = ncells;
      });
      const ncol = {};
      for (const ci of Object.keys(cols._)) {
        const oldCi = parseInt(ci, 10);
        const newCi = colRemap[oldCi];
        if (newCi !== undefined) ncol[newCi] = cols._[ci];
      }
      cols._ = ncol;
      this.remapMerges(null, colRemap);
      this.remapReferences({ col: remapAxisMap(colRemap) });
      const { selector } = this;
      const { sri, eri, sci: sc, eci: ec } = selector.range;
      selector.range = new CellRange(
        sri,
        colRemap[sc] ?? sc,
        eri,
        colRemap[ec] ?? ec,
      );
      if (selector.ci >= 0) {
        selector.ci = colRemap[selector.ci] ?? selector.ci;
      }
      selector.moveIndexes = [selector.ri, selector.ci];
    });
  }

  canUndo() {
    return this.history.canUndo();
  }

  canRedo() {
    return this.history.canRedo();
  }

  undo() {
    this.history.undo(this.getData(), (d) => {
      this.setData(withEmptyOptionalKeys(d));
    });
  }

  redo() {
    this.history.redo(this.getData(), (d) => {
      this.setData(withEmptyOptionalKeys(d));
    });
  }

  copy() {
    this.clipboard.copy(this.selector.range);
  }

  copyToSystemClipboard(evt) {
    let copyText = [];
    const {
      sri, eri, sci, eci,
    } = this.selector.range;

    for (let ri = sri; ri <= eri; ri += 1) {
      const nri = getDataRowIndex(this, ri);
      const row = [];
      for (let ci = sci; ci <= eci; ci += 1) {
        const cell = this.rows.getCell(nri, ci);
        row.push((cell && cell.text) || '');
      }
      copyText.push(row);
    }

    // Adding \n and why not adding \r\n is to support online office and client MS office and WPS
    copyText = formatTsvRows(copyText);
    const copyHtml = formatHtmlClipboard(this, this.selector.range);

    // why used this
    // cuz http protocol will be blocked request clipboard by browser
    if (evt) {
      evt.clipboardData.clearData();
      evt.clipboardData.setData('text/plain', copyText);
      evt.clipboardData.setData('text/html', copyHtml);
      evt.preventDefault();
    }

    // this need https protocol
    /* global navigator */
    if (navigator.clipboard) {
      if (window.ClipboardItem) {
        const htmlBlob = new Blob([copyHtml], { type: 'text/html' });
        const textBlob = new Blob([copyText], { type: 'text/plain' });
        navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': textBlob,
            'text/html': htmlBlob,
          }),
        ]).catch(() => {
          navigator.clipboard.writeText(copyText).then(() => {}, () => {});
        });
      } else {
        navigator.clipboard.writeText(copyText).then(() => {}, () => {});
      }
    }
  }

  cut() {
    this.clipboard.cut(this.selector.range);
  }

  // what: all | text | format
  paste(what = 'all', error = () => {}) {
    // console.log('sIndexes:', sIndexes);
    const { clipboard, selector } = this;
    if (clipboard.isClear()) return false;
    if (!canPaste.call(this, clipboard.range, selector.range, error)) return false;

    this.changeData(() => {
      if (clipboard.isCopy()) {
        copyPaste.call(this, clipboard.range, selector.range, what);
      } else if (clipboard.isCut()) {
        cutPaste.call(this, clipboard.range, selector.range);
      }
      this.revalidateAll();
    });
    return true;
  }

  pasteFromSystemClipboard(resetSheet, eventTrigger) {
    const { selector } = this;
    navigator.clipboard.readText().then((content) => {
      const contentToPaste = this.parseClipboardContent(content);
      let startRow = selector.ri;
      contentToPaste.forEach((row) => {
        let startColumn = selector.ci;
        row.forEach((cellContent) => {
          this.setCellText(startRow, startColumn, cellContent, 'input');
          startColumn += 1;
        });
        startRow += 1;
      });
      this.revalidateAll();
      resetSheet();
      eventTrigger(this.rows.getData());
    });
  }

  parseClipboardContent(clipboardContent) {
    return parseTsvRows(clipboardContent);
  }

  pasteFromText(txt) {
    const lines = this.parseClipboardContent(txt);

    if (lines.length) {
      const { rows, selector } = this;

      this.changeData(() => {
        rows.paste(lines, selector.range, (r) => getDataRowIndex(this, r));
        this.revalidateAll();
      });
    }
  }

  pasteFromHtml(html) {
    const parsed = parseHtmlClipboard(html);
    if (!parsed || parsed.rows.length <= 0) return false;
    const { rows, selector } = this;
    this.changeData(() => {
      const { sri, sci } = selector.range;
      const height = parsed.rows.length;
      const width = Math.max(...parsed.rows.map(row => row.length));
      const pasteRange = new CellRange(sri, sci, sri + height - 1, sci + width - 1);
      this.merges.deleteWithin(pasteRange);
      pasteRange.each((ri, ci) => {
        rows.deleteCell(getDataRowIndex(this, ri), ci, 'merge');
      });
      parsed.rows.forEach((row, i) => {
        const ri = getDataRowIndex(this, sri + i);
        row.forEach((cell, j) => {
          const ci = sci + j;
          if (cell.covered) {
            rows.deleteCell(ri, ci, 'all');
            return;
          }
          const nextCell = { text: cell.text };
          if (cell.style) {
            const styleIndex = this.addStyle(cell.style);
            if (styleIndex !== undefined) nextCell.style = styleIndex;
          }
          if (cell.merge) nextCell.merge = cell.merge;
          rows.setCell(ri, ci, nextCell);
        });
      });
      parsed.merges.forEach((merge) => {
        this.merges.add(new CellRange(
          sri + merge.sri,
          sci + merge.sci,
          sri + merge.eri,
          sci + merge.eci,
        ));
      });
      this.revalidateAll();
    });
    return true;
  }

  autofill(cellRange, what, error = () => {}) {
    const srcRange = this.selector.range;
    if (!canPaste.call(this, srcRange, cellRange, error)) return false;
    this.changeData(() => {
      copyPaste.call(this, srcRange, cellRange, what, true);
      this.revalidateAll();
    });
    return true;
  }

  clearClipboard() {
    this.clipboard.clear();
  }

  calSelectedRangeByEnd(ri, ci) {
    const {
      selector, rows, cols, merges,
    } = this;
    let {
      sri, sci, eri, eci,
    } = selector.range;
    const cri = selector.ri;
    const cci = selector.ci;
    let [nri, nci] = [ri, ci];
    if (ri < 0) nri = rows.len - 1;
    if (ci < 0) nci = cols.len - 1;
    if (nri > cri) [sri, eri] = [cri, nri];
    else [sri, eri] = [nri, cri];
    if (nci > cci) [sci, eci] = [cci, nci];
    else [sci, eci] = [nci, cci];
    selector.range = merges.union(new CellRange(
      sri, sci, eri, eci,
    ));
    selector.range = merges.union(selector.range);
    // console.log('selector.range:', selector.range);
    return selector.range;
  }

  calSelectedRangeByStart(ri, ci) {
    const {
      selector, rows, cols, merges,
    } = this;
    let cellRange = merges.getFirstIncludes(ri, ci);
    // console.log('cellRange:', cellRange, ri, ci, merges);
    if (cellRange === null) {
      cellRange = new CellRange(ri, ci, ri, ci);
      if (ri === -1) {
        cellRange.sri = 0;
        cellRange.eri = rows.len - 1;
      }
      if (ci === -1) {
        cellRange.sci = 0;
        cellRange.eci = cols.len - 1;
      }
    }
    selector.range = cellRange;
    return cellRange;
  }

  setSelectedCellAttr(property, value) {
    this.changeData(() => {
      const { selector, styles, rows } = this;
      if (property === 'merge') {
        if (value) this.merge();
        else this.unmerge();
      } else if (property === 'border') {
        setStyleBorders.call(this, value);
      } else if (property === 'formula') {
        // console.log('>>>', selector.multiple());
        const { ri, ci, range } = selector;
        if (selector.multiple()) {
          const [rn, cn] = selector.size();
          const {
            sri, sci, eri, eci,
          } = range;
          if (rn > 1) {
            for (let i = sci; i <= eci; i += 1) {
              const cell = rows.getCellOrNew(getDataRowIndex(this, eri + 1), i);
              cell.text = `=${value}(${xy2expr(i, sri)}:${xy2expr(i, eri)})`;
            }
          } else if (cn > 1) {
            const cell = rows.getCellOrNew(getDataRowIndex(this, ri), eci + 1);
            cell.text = `=${value}(${xy2expr(sci, ri)}:${xy2expr(eci, ri)})`;
          }
        } else {
          const cell = rows.getCellOrNew(getDataRowIndex(this, ri), ci);
          cell.text = `=${value}()`;
        }
      } else {
        selector.range.each((ri, ci) => {
          const cell = rows.getCellOrNew(getDataRowIndex(this, ri), ci);
          let cstyle = {};
          if (cell.style !== undefined) {
            cstyle = helper.cloneDeep(styles[cell.style]);
          }
          if (property === 'format') {
            cstyle.format = value;
            cell.style = this.addStyle(cstyle);
          } else if (property === 'font-bold' || property === 'font-italic'
            || property === 'font-name' || property === 'font-size') {
            applyFontStyleAttr(cstyle, property, value);
            cell.style = this.addStyle(cstyle);
          } else if (property === 'strike' || property === 'textwrap'
            || property === 'underline'
            || property === 'align' || property === 'valign'
            || property === 'color' || property === 'bgcolor') {
            cstyle[property] = value;
            cell.style = this.addStyle(cstyle);
          } else {
            cell[property] = value;
          }
        });
      }
    });
  }

  // state: input | finished
  setSelectedCellText(text, state = 'input', originalText) {
    const { autoFilter, selector, rows } = this;
    const { ri, ci } = selector;
    const nri = getDataRowIndex(this, ri);
    const oldCell = rows.getCell(nri, ci);
    const oldText = oldCell ? oldCell.text : '';
    this.setCellText(ri, ci, text, state, originalText);
    // replace filter.value
    if (autoFilter.active()) {
      const filter = autoFilter.getFilter(ci);
      if (filter) {
        const vIndex = filter.value.findIndex(v => v === oldText);
        if (vIndex >= 0) {
          filter.value.splice(vIndex, 1, text);
        }
        // console.log('filter:', filter, oldCell);
      }
    }
    // this.resetAutoFilter();
  }

  getSelectedCell() {
    const { ri, ci } = this.selector;
    return this.rows.getCell(getDataRowIndex(this, ri), ci);
  }

  xyInSelectedRect(x, y) {
    const {
      left, top, width, height,
    } = this.getSelectedRect();
    const x1 = x - this.cols.indexWidth;
    const y1 = y - this.rows.height;
    // console.log('x:', x, ',y:', y, 'left:', left, 'top:', top);
    return x1 > left && x1 < (left + width)
      && y1 > top && y1 < (top + height);
  }

  getSelectedRect() {
    return this.getRect(this.selector.range);
  }

  getClipboardRect() {
    const { clipboard } = this;
    if (!clipboard.isClear()) {
      return this.getRect(clipboard.range);
    }
    return {
      left: -100, top: -100, width: 0, height: 0, l: 0, t: 0, scroll: this.scroll,
    };
  }

  getImageDisplayRect(anchor) {
    const { scroll, rows, cols, exceptRowSet } = this;
    const col = anchor.col ?? 0;
    const row = anchor.row ?? 0;
    const ci = Math.floor(col);
    const ri = Math.floor(row);
    const colFrac = col - ci;
    const rowFrac = row - ri;

    const left = cols.sumWidth(0, ci) + colFrac * cols.getWidth(ci);
    const top = rows.sumHeight(0, ri, exceptRowSet) + rowFrac * rows.getHeight(ri);

    let width;
    let height;
    if (anchor.width != null && anchor.height != null) {
      width = anchor.width * this.zoomScale;
      height = anchor.height * this.zoomScale;
    } else if (anchor.brCol != null && anchor.brRow != null) {
      const brCi = Math.floor(anchor.brCol);
      const brRi = Math.floor(anchor.brRow);
      const brColFrac = anchor.brCol - brCi;
      const brRowFrac = anchor.brRow - brRi;
      const right = cols.sumWidth(0, brCi) + brColFrac * cols.getWidth(brCi);
      const bottom = rows.sumHeight(0, brRi, exceptRowSet) + brRowFrac * rows.getHeight(brRi);
      width = Math.max(right - left, 1);
      height = Math.max(bottom - top, 1);
    } else {
      width = 64;
      height = 64;
    }

    let left0 = left - scroll.x;
    let top0 = top - scroll.y;
    const fsh = this.freezeTotalHeight();
    const fsw = this.freezeTotalWidth();
    if (fsw > 0 && fsw > left) {
      left0 = left;
    }
    if (fsh > 0 && fsh > top) {
      top0 = top;
    }
    return {
      l: left,
      t: top,
      left: left0,
      top: top0,
      width,
      height,
      scroll,
    };
  }

  getFractionalCellFromSheetXY(sheetX, sheetY) {
    const { cols, rows, exceptRowSet } = this;
    const clampedX = Math.max(0, Math.min(sheetX, cols.totalWidth()));
    const clampedY = Math.max(0, Math.min(sheetY, rows.totalHeight()));

    let col = 0;
    let x = 0;
    for (let ci = 0; ci < cols.len; ci += 1) {
      const cw = cols.getWidth(ci);
      if (clampedX < x + cw || ci === cols.len - 1) {
        col = cw > 0 ? ci + (clampedX - x) / cw : ci;
        break;
      }
      x += cw;
    }

    let row = 0;
    let y = 0;
    for (let ri = 0; ri < rows.len; ri += 1) {
      if (exceptRowSet.has(ri)) continue;
      const rh = rows.getHeight(ri);
      if (clampedY < y + rh || ri === rows.len - 1) {
        row = rh > 0 ? ri + (clampedY - y) / rh : ri;
        break;
      }
      y += rh;
    }

    return { col, row };
  }

  getRect(cellRange) {
    const {
      scroll, rows, cols, exceptRowSet,
    } = this;
    const {
      sri, sci, eri, eci,
    } = cellRange;
    // console.log('sri:', sri, ',sci:', sci, ', eri:', eri, ', eci:', eci);
    // no selector
    if (sri < 0 && sci < 0) {
      return {
        left: 0, l: 0, top: 0, t: 0, scroll,
      };
    }
    const left = cols.sumWidth(0, sci);
    const top = rows.sumHeight(0, sri, exceptRowSet);
    const height = rows.sumHeight(sri, eri + 1, exceptRowSet);
    const width = cols.sumWidth(sci, eci + 1);
    // console.log('sri:', sri, ', sci:', sci, ', eri:', eri, ', eci:', eci);
    let left0 = left - scroll.x;
    let top0 = top - scroll.y;
    const fsh = this.freezeTotalHeight();
    const fsw = this.freezeTotalWidth();
    if (fsw > 0 && fsw > left) {
      left0 = left;
    }
    if (fsh > 0 && fsh > top) {
      top0 = top;
    }
    return {
      l: left,
      t: top,
      left: left0,
      top: top0,
      height,
      width,
      scroll,
    };
  }

  getCellRectByXY(x, y) {
    const {
      scroll, merges, rows, cols,
    } = this;
    let { ri, top, height } = getCellRowByY.call(this, y, scroll.y);
    let { ci, left, width } = getCellColByX.call(this, x, scroll.x);
    if (ci === -1) {
      width = cols.totalWidth();
    }
    if (ri === -1) {
      height = rows.totalHeight();
    }
    if (ri >= 0 || ci >= 0) {
      const merge = merges.getFirstIncludes(ri, ci);
      if (merge) {
        ri = merge.sri;
        ci = merge.sci;
        ({
          left, top, width, height,
        } = this.cellRect(ri, ci));
      }
    }
    return {
      ri, ci, left, top, width, height,
    };
  }

  isSingleSelected() {
    const {
      sri, sci, eri, eci,
    } = this.selector.range;
    const cell = this.getCell(sri, sci);
    if (cell && cell.merge) {
      const [rn, cn] = cell.merge;
      if (sri + rn === eri && sci + cn === eci) return true;
    }
    return !this.selector.multiple();
  }

  canUnmerge() {
    const {
      sri, sci, eri, eci,
    } = this.selector.range;
    const cell = this.getCell(sri, sci);
    if (cell && cell.merge) {
      const [rn, cn] = cell.merge;
      if (sri + rn === eri && sci + cn === eci) return true;
    }
    return false;
  }

  merge() {
    const { selector, rows } = this;
    if (this.isSingleSelected()) return;
    const [rn, cn] = selector.size();
    if (rn > 1 || cn > 1) {
      const { sri, sci, eri, eci } = selector.range;
      // collect all non-empty cell texts before deleting
      const texts = [];
      for (let r = sri; r <= eri; r += 1) {
        for (let c = sci; c <= eci; c += 1) {
          const cell = rows.getCell(getDataRowIndex(this, r), c);
          if (cell && cell.text && cell.text.trim() !== '') {
            texts.push(cell.text.trim());
          }
        }
      }
      this.changeData(() => {
        const cell = rows.getCellOrNew(getDataRowIndex(this, sri), sci);
        cell.merge = [rn - 1, cn - 1];
        if (texts.length > 0) cell.text = texts.join(' ');
        this.merges.add(selector.range);
        selector.range.each((ri, ci) => {
          if (ri !== sri || ci !== sci) {
            rows.deleteCell(getDataRowIndex(this, ri), ci, 'all');
          }
        });
        rows.setCell(getDataRowIndex(this, sri), sci, cell);
      });
    }
  }

  unmerge() {
    const { selector } = this;
    if (!this.isSingleSelected()) return;
    const { sri, sci } = selector.range;
    this.changeData(() => {
      this.rows.deleteCell(getDataRowIndex(this, sri), sci, 'merge');
      this.merges.deleteWithin(selector.range);
    });
  }

  canAutofilter() {
    return !this.autoFilter.active();
  }

  autofilter() {
    const { autoFilter, selector } = this;
    this.changeData(() => {
      if (autoFilter.active()) {
        autoFilter.clear();
        this.exceptRowSet = new Set();
        this.sortedRowMap = new Map();
        this.unsortedRowMap = new Map();
      } else {
        autoFilter.ref = selector.range.toString();
      }
    });
  }

  setAutoFilter(ci, order, operator, value) {
    this.changeData(() => {
      const { autoFilter } = this;
      autoFilter.addFilter(ci, operator, value);
      autoFilter.setSort(ci, order);
      this.resetAutoFilter();
    });
  }

  resetAutoFilter() {
    const { autoFilter, rows } = this;
    if (!autoFilter.active()) {
      this.exceptRowSet = new Set();
      this.sortedRowMap = new Map();
      this.unsortedRowMap = new Map();
      return;
    }
    const { sort } = autoFilter;
    const { sri } = autoFilter.range();
    const { rset, fset } = autoFilter.filteredRows((r, c) => rows.getCell(r, c));
    const fary = Array.from(fset);
    const oldAry = Array.from(fset);
    if (sort) {
      fary.sort((a, b) => {
        const aText = getCellSortText(rows, a, sort.ci);
        const bText = getCellSortText(rows, b, sort.ci);
        const result = compareSortCellText(aText, bText, sort.order);
        if (sort.order === 'asc' || sort.order === 'desc') return result || (a - b);
        return 0;
      });
    }
    rset.delete(sri);
    this.exceptRowSet = rset;
    this.sortedRowMap = new Map();
    this.unsortedRowMap = new Map();
    fary.forEach((it, index) => {
      this.sortedRowMap.set(oldAry[index], it);
      this.unsortedRowMap.set(it, oldAry[index]);
    });
    // After filtering, go back to the header row; the first row is never filtered and is always visible
    const { scroll } = this;
    scroll.ri = sri;
    scroll.y = rows.sumHeight(0, sri, this.exceptRowSet);
  }

  deleteCell(what = 'all') {
    const { selector } = this;
    this.changeData(() => {
      selector.range.each((ri, ci) => {
        this.rows.deleteCell(getDataRowIndex(this, ri), ci, what);
      });
      if (what === 'all' || what === 'format') {
        this.merges.deleteWithin(selector.range);
      }
    });
  }

  // type: row | column
  insert(type, n = 1) {
    this.changeData(() => {
      const { sci } = this.selector.range;
      // under an autofilter sort the selected (view) row is not the data row
      const sri = getDataRowIndex(this, this.selector.range.sri);
      const { rows, merges, cols } = this;
      let si = sri;
      if (type === 'row') {
        rows.insert(sri, n);
      } else if (type === 'column') {
        rows.insertColumn(sci, n);
        si = sci;
        cols.len += n;
        Object.keys(cols._).reverse().forEach((colIndex) => {
          const col = parseInt(colIndex, 10);
          if (col >= sci) {
            cols._[col + n] = cols._[col];
            delete cols._[col];
          }
        });
      }
      merges.shift(type, si, n, (ri, ci, rn, cn) => {
        const cell = rows.getCell(ri, ci);
        cell.merge[0] += rn;
        cell.merge[1] += cn;
      });
      this.remapReferences(type === 'row' ? { row: insertAxisMap(si, n) } : { col: insertAxisMap(si, n) });
      // the filtered and sorted rows are computed again on the moved data
      this.resetAutoFilter();
    });
  }

  // type: row | column
  delete(type) {
    this.changeData(() => {
      const {
        rows, merges, selector, cols,
      } = this;
      const { range } = selector;
      const {
        sri, sci, eri, eci,
      } = selector.range;
      const [rsize, csize] = selector.range.size();
      let si = sri;
      let size = rsize;
      if (type === 'row' && this.sortedRowMap.size > 0) {
        // under an autofilter sort the selected rows are scattered data rows: delete each one,
        // from the bottom up so that the indexes still to delete don't move
        const dataRows = [];
        for (let ri = sri; ri <= eri; ri += 1) dataRows.push(getDataRowIndex(this, ri));
        dataRows.sort((a, b) => b - a).forEach((dri) => {
          rows.delete(dri, dri);
          merges.deleteSpan('row', dri, dri);
          this.remapReferences({ row: deleteAxisMap(dri, dri) });
        });
        syncCellMergesFromRanges.call(this);
        this.resetAutoFilter();
        return;
      }
      if (type === 'row') {
        rows.delete(sri, eri);
      } else if (type === 'column') {
        rows.deleteColumn(sci, eci);
        si = range.sci;
        size = csize;
        cols.len -= (eci - sci + 1);
        Object.keys(cols._).forEach((colIndex) => {
          const col = parseInt(colIndex, 10);
          if (col >= sci) {
            if (col > eci) cols._[col - (eci - sci + 1)] = cols._[col];
            delete cols._[col];
          }
        });
      }
      // merges inside the deleted block go away, the others shrink or move up/left
      merges.deleteSpan(type, si, si + size - 1);
      syncCellMergesFromRanges.call(this);
      const deleted = deleteAxisMap(si, si + size - 1);
      this.remapReferences(type === 'row' ? { row: deleted } : { col: deleted });
      this.resetAutoFilter();
    });
  }

  scrollx(x, cb) {
    const { scroll, cols } = this;
    const contentWidth = cols.totalWidth();
    const maxX = Math.max(0, contentWidth - this.contentViewWidth());
    const x1 = Math.max(0, Math.min(x, maxX));
    if (scroll.x !== x1) {
      scroll.x = x1;
      scroll.ci = getScrollColIndex.call(this, x1);
      cb();
    }
  }

  scrolly(y, cb) {
    const { scroll, rows } = this;
    const erth = this.exceptRowTotalHeight(0, -1);
    const contentHeight = rows.totalHeight() - erth;
    const maxY = Math.max(0, contentHeight - this.contentViewHeight());
    const y1 = Math.max(0, Math.min(y, maxY));
    if (scroll.y !== y1) {
      scroll.y = y1;
      scroll.ri = getScrollRowIndex.call(this, y1);
      cb();
    }
  }

  cellRect(ri, ci) {
    const { rows, cols, exceptRowSet } = this;
    const left = cols.sumWidth(0, ci);
    const top = rows.sumHeight(0, ri, exceptRowSet);
    const cell = rows.getCell(getDataRowIndex(this, ri), ci);
    let width = cols.getWidth(ci);
    let height = rows.getHeight(ri);
    if (cell !== null) {
      if (cell.merge) {
        const [rn, cn] = cell.merge;
        if (rn > 0) {
          height = rows.sumHeight(ri, ri + rn + 1, exceptRowSet);
        }
        if (cn > 0) {
          for (let i = 1; i <= cn; i += 1) {
            width += cols.getWidth(ci + i);
          }
        }
      }
    }
    // console.log('data:', this.d);
    return {
      left, top, width, height, cell,
    };
  }

  getCell(ri, ci) {
    return this.rows.getCell(getDataRowIndex(this, ri), ci);
  }

  getCellTextOrDefault(ri, ci) {
    const cell = this.getCell(ri, ci);
    return (cell && cell.text) ? cell.text : '';
  }

  getCellStyle(ri, ci) {
    const cell = this.getCell(ri, ci);
    if (cell && cell.style !== undefined) {
      return this.styles[cell.style];
    }
    return null;
  }

  getCellStyleOrDefault(ri, ci) {
    const { styles, rows } = this;
    const cell = rows.getCell(getDataRowIndex(this, ri), ci);
    const cellStyle = (cell && cell.style !== undefined) ? styles[cell.style] : {};
    return helper.merge(this.defaultStyle(), cellStyle);
  }

  getSelectedCellStyle() {
    const { ri, ci } = this.selector;
    return this.getCellStyleOrDefault(ri, ci);
  }

  /** View row of a data row, when an autofilter sort reorders the rows. */
  getViewRowIndex(ri) {
    return this.unsortedRowMap.has(ri) ? this.unsortedRowMap.get(ri) : ri;
  }

  canEditCell(ri, ci) {
    const nri = getDataRowIndex(this, ri);
    if (this.sheetProtection) {
      const cell = this.rows.getCell(nri, ci);
      return cell?.editable === true;
    }
    const cell = this.rows.getCell(nri, ci);
    return !cell || cell.editable !== false;
  }

  // state: input | finished
  // originalText: the text before the edit; while typing, 'input' already wrote the new text
  setCellText(ri, ci, text, state, originalText) {
    if (!this.canEditCell(ri, ci)) return;
    const nri = getDataRowIndex(this, ri);
    const { rows, history, validations } = this;
    if (state === 'finished') {
      const current = rows.getCell(nri, ci)?.text ?? '';
      const before = originalText !== undefined ? originalText : current;
      if (before !== text) {
        // the undo step holds the text from before the edit
        rows.setCellText(nri, ci, before);
        history.add(this.getData());
      }
      rows.setCellText(nri, ci, text);
    } else {
      rows.setCellText(nri, ci, text);
      this.change(this.getData());
    }
    validations.validate(nri, ci, text);
  }

  revalidateAll() {
    const { rows, validations } = this;
    // Cap to sheet row length so whole-column Excel validations (e.g. E2:E1048576)
    // do not iterate millions of empty cells on load.
    const maxRi = Math.max(0, rows.len - 1);
    validations.validateAll((ri, ci) => {
      const cell = rows.getCell(ri, ci);
      return (cell && cell.text) ? cell.text : '';
    }, maxRi);
  }

  ensureViewExtent() {
    const { rows, cols } = this;
    if (rows.len < MIN_VIEW_ROWS) rows.len = MIN_VIEW_ROWS;
    if (cols.len < MIN_VIEW_COLS) cols.len = MIN_VIEW_COLS;
  }

  expandViewRows() {
    const { rows } = this;
    const prev = rows.len;
    rows.len = prev * 2;
    return rows.len > prev;
  }

  expandViewCols() {
    const { cols } = this;
    const prev = cols.len;
    cols.len = prev * 2;
    return cols.len > prev;
  }

  getValidationError(ri, ci) {
    return this.validations.getError(getDataRowIndex(this, ri), ci);
  }

  freezeIsActive() {
    const [ri, ci] = this.freeze;
    return ri > 0 || ci > 0;
  }

  setFreeze(ri, ci) {
    this.changeData(() => {
      this.freeze = [ri, ci];
    });
  }

  freezeTotalWidth() {
    return this.cols.sumWidth(0, this.freeze[1]);
  }

  freezeTotalHeight() {
    return this.rows.sumHeight(0, this.freeze[0]);
  }

  setRowHeight(ri, height) {
    this.changeData(() => {
      this.rows.setHeight(ri, height);
    });
  }

  setRowsHeight(sri, eri, height) {
    this.changeData(() => {
      for (let ri = sri; ri <= eri; ri += 1) {
        this.rows.setHeight(ri, height);
      }
    });
  }

  setColWidth(ci, width) {
    this.changeData(() => {
      this.cols.setWidth(ci, width);
    });
  }

  setColsWidth(sci, eci, width) {
    this.changeData(() => {
      for (let ci = sci; ci <= eci; ci += 1) {
        this.cols.setWidth(ci, width);
      }
    });
  }

  viewHeight() {
    const { view, showToolbar, showBottomBar } = this.settings;
    let h = view.height();
    if (showBottomBar) {
      h -= bottombarHeight;
    }
    if (showToolbar) {
      h -= toolbarHeight;
    }
    h -= formulaBarHeight;
    return h;
  }

  viewWidth() {
    return this.settings.view.width();
  }

  contentViewWidth() {
    return this.viewWidth() - this.cols.indexWidth;
  }

  contentViewHeight() {
    return this.viewHeight() - this.rows.height;
  }

  freezeViewRange() {
    const [ri, ci] = this.freeze;
    return new CellRange(0, 0, ri - 1, ci - 1, this.freezeTotalWidth(), this.freezeTotalHeight());
  }

  contentRange() {
    const { rows, cols } = this;
    const [ri, ci] = rows.maxCell();
    const h = rows.sumHeight(0, ri + 1);
    const w = cols.sumWidth(0, ci + 1);
    return new CellRange(0, 0, ri, ci, w, h);
  }

  exceptRowTotalHeight(sri, eri) {
    const { exceptRowSet, rows } = this;
    const exceptRows = Array.from(exceptRowSet);
    let exceptRowTH = 0;
    exceptRows.forEach((ri) => {
      if (ri < sri || ri > eri) {
        const height = rows.getHeight(ri);
        exceptRowTH += height;
      }
    });
    return exceptRowTH;
  }

  viewRange() {
    const {
      scroll, rows, cols, freeze, exceptRowSet,
    } = this;
    // console.log('scroll:', scroll, ', freeze:', freeze)
    let { ri, ci } = scroll;
    if (ri <= 0) [ri] = freeze;
    if (ci <= 0) [, ci] = freeze;

    const partialRowOffset = scroll.y - rows.sumHeight(0, ri, exceptRowSet);
    const partialColOffset = scroll.x - cols.sumWidth(0, ci);
    const viewH = this.contentViewHeight() + Math.max(0, partialRowOffset);
    const viewW = this.contentViewWidth() + Math.max(0, partialColOffset);

    let [x, y] = [0, 0];
    let [eri, eci] = [rows.len, cols.len];
    for (let i = ri; i < rows.len; i += 1) {
      if (!exceptRowSet.has(i)) {
        y += rows.getHeight(i);
        eri = i;
      }
      if (y > viewH) break;
    }
    for (let j = ci; j < cols.len; j += 1) {
      x += cols.getWidth(j);
      eci = j;
      if (x > viewW) break;
    }
    // console.log(ri, ci, eri, eci, x, y);
    return new CellRange(ri, ci, eri, eci, x, y);
  }

  eachMergesInView(viewRange, cb) {
    this.merges.filterIntersects(viewRange)
      .forEach(it => cb(it));
  }

  // an edit like any other: undo step, change event (the document becomes dirty)
  hideRowsOrCols() {
    const { rows, cols, selector } = this;
    const [rlen, clen] = selector.size();
    const {
      sri, sci, eri, eci,
    } = selector.range;
    this.changeData(() => {
      if (rlen === rows.len) {
        for (let ci = sci; ci <= eci; ci += 1) {
          cols.setHide(ci, true);
        }
      } else if (clen === cols.len) {
        for (let ri = sri; ri <= eri; ri += 1) {
          rows.setHide(ri, true);
        }
      }
    });
  }

  // type: row | col
  // index row-index | col-index
  unhideRowsOrCols(type, index) {
    this.changeData(() => {
      this[`${type}s`].unhide(index);
    });
  }

  rowEach(min, max, cb) {
    let y = 0;
    const { rows } = this;
    const frset = this.exceptRowSet;
    const frary = [...frset];
    let offset = 0;
    for (let i = 0; i < frary.length; i += 1) {
      if (frary[i] < min) {
        offset += 1;
      }
    }
    // console.log('min:', min, ', max:', max, ', scroll:', scroll);
    for (let i = min + offset; i <= max + offset; i += 1) {
      if (frset.has(i)) {
        offset += 1;
      } else {
        const rowHeight = rows.getHeight(i);
        if (rowHeight > 0) {
          cb(i, y, rowHeight);
          y += rowHeight;
          if (y > this.viewHeight()) break;
        }
      }
    }
  }

  colEach(min, max, cb) {
    let x = 0;
    const { cols } = this;
    for (let i = min; i <= max; i += 1) {
      const colWidth = cols.getWidth(i);
      if (colWidth > 0) {
        cb(i, x, colWidth);
        x += colWidth;
        if (x > this.viewWidth()) break;
      }
    }
  }

  defaultStyle() {
    return this.settings.style;
  }

  getZoomScale() {
    return this.zoomScale || 1;
  }

  setZoomScale(scale) {
    const nextScale = Math.max(MIN_ZOOM_SCALE, Math.min(MAX_ZOOM_SCALE, scale));
    if (nextScale === this.zoomScale) return false;
    this.zoomScale = nextScale;
    this.rows.setZoomScale(nextScale);
    this.cols.setZoomScale(nextScale);
    return true;
  }

  addStyle(nstyle) {
    const { styles } = this;
    // console.log('old.styles:', styles, nstyle);
    for (let i = 0; i < styles.length; i += 1) {
      const style = styles[i];
      if (helper.equals(style, nstyle)) return i;
    }
    styles.push(nstyle);
    return styles.length - 1;
  }

  changeData(cb) {
    this.history.add(this.getData());
    cb();
    this.change(this.getData());
  }

  setData(d) {
    const shouldSyncCellMerges = Object.prototype.hasOwnProperty.call(d, 'merges');
    Object.keys(d).forEach((property) => {
      if (property === 'merges' || property === 'rows'
        || property === 'cols' || property === 'validations') {
        this[property].setData(d[property]);
      } else if (property === 'freeze') {
        const [x, y] = expr2xy(d[property]);
        this.freeze = [y, x];
      } else if (property === 'autofilter') {
        this.autoFilter.setData(d[property]);
      } else if (property === 'hyperlinks') {
        this.hyperlinks = d[property] || {};
      } else if (property === 'images') {
        this.images = d[property] || [];
      } else if (property === 'backgroundImage') {
        this.backgroundImage = d[property] || null;
      } else if (d[property] !== undefined) {
        this[property] = d[property];
      }
    });
    if (shouldSyncCellMerges) {
      syncCellMergesFromRanges.call(this);
    }
    this.resetAutoFilter();
    if (d.rows || d.cols) {
      this.ensureViewExtent();
    }
    if (d.validations) {
      this.revalidateAll();
    }
    return this;
  }

  getData() {
    const {
      name, freeze, styles, merges, rows, cols, validations, autoFilter, hyperlinks, sheetProtection,
      images, backgroundImage, codeName, sourceSheetId, extraValidations,
    } = this;
    const data = {
      name,
      freeze: xy2expr(freeze[1], freeze[0]),
      styles,
      merges: merges.getData(),
      rows: rows.getData(),
      cols: cols.getData(),
      validations: validations.getData(),
      autofilter: autoFilter.getData(),
    };
    if (hyperlinks && Object.keys(hyperlinks).length > 0) {
      data.hyperlinks = hyperlinks;
    }
    if (images && images.length > 0) {
      data.images = images;
    }
    if (backgroundImage) {
      data.backgroundImage = backgroundImage;
    }
    if (sheetProtection) {
      data.sheetProtection = sheetProtection;
    }
    if (codeName) {
      data.codeName = codeName;
    }
    if (sourceSheetId != null) {
      data.sourceSheetId = sourceSheetId;
    }
    if (extraValidations && extraValidations.length > 0) {
      data.extraValidations = extraValidations;
    }
    return data;
  }
}
