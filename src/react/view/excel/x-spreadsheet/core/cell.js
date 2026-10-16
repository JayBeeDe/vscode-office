import { evaluateFormula, formatFormulaValue, FormulaError } from './formula_engine';

/**
 * Text shown for a cell: the result of its formula, or its text.
 * getCellText(col, row, sheet) gives a cell's text (sheet is null for the current sheet, and
 * the result is undefined for a sheet that doesn't exist). cached is the result saved in the
 * file, shown when the formula uses a function the viewer doesn't know.
 */
const cellRender = (src, formulaMap, getCellText, cached) => {
  if (typeof src === 'string' && src[0] === '=' && src.length > 1) {
    const value = evaluateFormula(src.substring(1), getCellText, new Set(), formulaMap);
    if (value instanceof FormulaError && value.code === '#NAME?' && cached != null) {
      return String(cached);
    }
    return formatFormulaValue(value);
  }
  return src;
};

export default {
  render: cellRender,
};
