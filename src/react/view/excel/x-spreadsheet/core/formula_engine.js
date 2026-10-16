// Formula evaluation: a tokenizer, a recursive-descent parser with Excel's operator precedence
// and an evaluator with Excel's coercion rules and error values.
//
// Values: number | string | boolean | null (empty cell) | FormulaError | Range (from A1:B2).

import { indexAt } from './alphabet';

export class FormulaError {
  constructor(code) {
    this.code = code;
  }

  toString() {
    return this.code;
  }
}

const ERRORS = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];
const err = code => new FormulaError(code);
const isError = v => v instanceof FormulaError;

class Range {
  constructor(values) {
    this.values = values;
  }
}

// ---------------------------------------------------------------- tokenizer

const REF_RE = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)/;
const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_RE = /^[A-Za-z_][\w.]*/;
const ERROR_RE = /^#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)/i;

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }
    const rest = src.slice(i);
    if (c === '"') {
      let value = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          break;
        }
        value += src[i];
        i += 1;
      }
      // an unclosed string ends with the text
      i += 1;
      tokens.push({ type: 'string', value });
      continue;
    }
    const errorMatch = ERROR_RE.exec(rest);
    if (errorMatch) {
      tokens.push({ type: 'error', value: errorMatch[0].toUpperCase() });
      i += errorMatch[0].length;
      continue;
    }
    const refMatch = REF_RE.exec(rest);
    // a reference is not followed by "(" (that would be a function such as LOG10()
    if (refMatch && !/^[\w(]/.test(rest.slice(refMatch[0].length))) {
      const sheet = refMatch[1] != null ? refMatch[1].replace(/''/g, "'") : refMatch[2];
      tokens.push({
        type: 'ref',
        sheet: sheet || null,
        col: indexAt(refMatch[4].toUpperCase()),
        row: Number(refMatch[6]) - 1,
      });
      i += refMatch[0].length;
      continue;
    }
    const numberMatch = NUMBER_RE.exec(rest);
    if (numberMatch) {
      tokens.push({ type: 'number', value: Number(numberMatch[0]) });
      i += numberMatch[0].length;
      continue;
    }
    const nameMatch = NAME_RE.exec(rest);
    if (nameMatch) {
      tokens.push({ type: 'name', value: nameMatch[0].toUpperCase() });
      i += nameMatch[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/^&=<>%(),;:'.includes(c)) {
      tokens.push({ type: 'op', value: c === ';' ? ',' : c });
      i += 1;
      continue;
    }
    throw err('#NAME?');
  }
  return tokens;
}

// ---------------------------------------------------------------- parser

function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value) => {
    const t = tokens[pos];
    return t && t.type === 'op' && t.value === value;
  };
  const expectOp = (value) => {
    if (!isOp(value)) throw err('#NAME?');
    pos += 1;
  };

  function primary() {
    const t = peek();
    if (!t) throw err('#NAME?');
    pos += 1;
    if (t.type === 'number' || t.type === 'string') return { type: 'literal', value: t.value };
    if (t.type === 'error') return { type: 'literal', value: err(t.value) };
    if (t.type === 'ref') {
      if (isOp(':')) {
        pos += 1;
        const end = peek();
        if (!end || end.type !== 'ref') throw err('#REF!');
        pos += 1;
        return { type: 'range', sheet: t.sheet, start: t, end };
      }
      return { type: 'ref', sheet: t.sheet, col: t.col, row: t.row };
    }
    if (t.type === 'name') {
      if (isOp('(')) {
        pos += 1;
        const args = [];
        if (!isOp(')')) {
          for (;;) {
            // an empty argument, as in IF(A1,,1)
            if (isOp(',') || isOp(')')) args.push({ type: 'literal', value: null });
            else args.push(comparison());
            if (isOp(',')) {
              pos += 1;
              continue;
            }
            break;
          }
        }
        expectOp(')');
        return { type: 'call', name: t.value, args };
      }
      if (t.value === 'TRUE' || t.value === 'FALSE') return { type: 'literal', value: t.value === 'TRUE' };
      return { type: 'literal', value: err('#NAME?') };
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = comparison();
      expectOp(')');
      return inner;
    }
    throw err('#NAME?');
  }

  function postfix() {
    let node = primary();
    while (isOp('%')) {
      pos += 1;
      node = { type: 'percent', operand: node };
    }
    return node;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = peek().value;
      pos += 1;
      const operand = unary();
      return op === '-' ? { type: 'negate', operand } : operand;
    }
    return postfix();
  }

  const binaryLevel = (ops, next, rightAssoc = false) => function level() {
    let left = next();
    while (ops.some(isOp)) {
      const op = peek().value;
      pos += 1;
      const right = rightAssoc ? level() : next();
      left = { type: 'binary', op, left, right };
    }
    return left;
  };

  // Excel: unary minus binds tighter than ^ (=-2^2 is 4)
  const power = binaryLevel(['^'], unary);
  const multiplicative = binaryLevel(['*', '/'], power);
  const additive = binaryLevel(['+', '-'], multiplicative);
  const concat = binaryLevel(['&'], additive);
  const comparison = binaryLevel(['=', '<>', '<', '>', '<=', '>='], concat);

  const ast = comparison();
  if (pos < tokens.length) throw err('#NAME?');
  return ast;
}

// ---------------------------------------------------------------- coercion

/** Value of a cell's text, as typed: number, boolean, error or text. */
function literalOf(text) {
  if (text === '' || text == null) return null;
  const trimmed = String(text).trim();
  if (trimmed !== '' && !Number.isNaN(Number(trimmed)) && /^[\s+\-.\d]/.test(trimmed)) return Number(trimmed);
  const upper = trimmed.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  if (ERRORS.includes(upper)) return err(upper);
  return String(text);
}

function toNumber(v) {
  if (isError(v)) return v;
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const trimmed = v.trim();
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isNaN(n) ? err('#VALUE!') : n;
}

function toText(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return formatNumber(v);
  return String(v);
}

function toBool(v) {
  if (isError(v)) return v;
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const upper = v.toUpperCase();
  if (upper === 'TRUE') return true;
  if (upper === 'FALSE') return false;
  return err('#VALUE!');
}

/** Numbers without binary floating-point noise: 0.1+0.2 is 0.3. */
export function formatNumber(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  return String(Number(n.toPrecision(15)));
}

// a single value from a range used where one value is expected
const scalar = v => (v instanceof Range ? (v.values.length === 1 ? v.values[0] : err('#VALUE!')) : v);

/** Excel order: numbers < text < booleans; text is compared without case. */
function compare(a, b) {
  const rank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  let left = a;
  let right = b;
  // an empty cell compares as 0, "" or FALSE, like the other side
  if (left == null) left = typeof right === 'string' ? '' : typeof right === 'boolean' ? false : 0;
  if (right == null) right = typeof left === 'string' ? '' : typeof left === 'boolean' ? false : 0;
  if (rank(left) !== rank(right)) return rank(left) - rank(right);
  if (typeof left === 'string') {
    const x = left.toLowerCase();
    const y = right.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof left === 'boolean') return Number(left) - Number(right);
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------- functions

/** Numbers of the arguments: from ranges only numbers count, typed arguments are coerced. */
function collectNumbers(args) {
  const out = [];
  for (const arg of args) {
    if (arg instanceof Range) {
      for (const v of arg.values) {
        if (isError(v)) return v;
        if (typeof v === 'number') out.push(v);
      }
    } else if (arg != null) {
      const n = toNumber(arg);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const flatten = args => args.flatMap(a => (a instanceof Range ? a.values : [a]));
const firstError = values => values.find(isError);

const FUNCTIONS = {
  SUM: (args) => {
    const nums = collectNumbers(args);
    return isError(nums) ? nums : nums.reduce((a, b) => a + b, 0);
  },
  AVERAGE: (args) => {
    const nums = collectNumbers(args);
    if (isError(nums)) return nums;
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : err('#DIV/0!');
  },
  MAX: (args) => {
    const nums = collectNumbers(args);
    return isError(nums) ? nums : (nums.length ? Math.max(...nums) : 0);
  },
  MIN: (args) => {
    const nums = collectNumbers(args);
    return isError(nums) ? nums : (nums.length ? Math.min(...nums) : 0);
  },
  COUNT: args => flatten(args).filter(v => typeof v === 'number').length,
  COUNTA: args => flatten(args).filter(v => v != null && v !== '').length,
  PRODUCT: (args) => {
    const nums = collectNumbers(args);
    return isError(nums) ? nums : nums.reduce((a, b) => a * b, 1);
  },
  ABS: ([v]) => {
    const n = toNumber(scalar(v));
    return isError(n) ? n : Math.abs(n);
  },
  ROUND: ([v, d]) => {
    const n = toNumber(scalar(v));
    const digits = toNumber(scalar(d ?? 0));
    if (isError(n)) return n;
    if (isError(digits)) return digits;
    const f = 10 ** Math.trunc(digits);
    return Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9) / f;
  },
  IF: ([cond, whenTrue, whenFalse]) => {
    const b = toBool(scalar(cond));
    if (isError(b)) return b;
    if (b) return whenTrue === undefined ? true : whenTrue;
    return whenFalse === undefined ? false : whenFalse;
  },
  IFERROR: ([v, fallback]) => (isError(scalar(v)) ? fallback : v),
  AND: (args) => {
    const values = flatten(args).filter(v => v != null);
    const bad = firstError(values);
    if (bad) return bad;
    return values.every(v => toBool(v) === true);
  },
  OR: (args) => {
    const values = flatten(args).filter(v => v != null);
    const bad = firstError(values);
    if (bad) return bad;
    return values.some(v => toBool(v) === true);
  },
  NOT: ([v]) => {
    const b = toBool(scalar(v));
    return isError(b) ? b : !b;
  },
  CONCAT: (args) => {
    const values = flatten(args);
    return firstError(values) || values.map(toText).join('');
  },
  LEN: ([v]) => toText(scalar(v)).length,
  UPPER: ([v]) => toText(scalar(v)).toUpperCase(),
  LOWER: ([v]) => toText(scalar(v)).toLowerCase(),
  TRIM: ([v]) => toText(scalar(v)).trim().replace(/ +/g, ' '),
};
FUNCTIONS.CONCATENATE = FUNCTIONS.CONCAT;

// ---------------------------------------------------------------- evaluator

/**
 * @param {string} src formula without its leading "="
 * @param {(col: number, row: number, sheet: string|null) => string|undefined} getCellText
 *        text of a cell; undefined when the sheet doesn't exist
 * @param {Set<string>} visiting cells being evaluated, to detect circular references
 * @param {object} formulaMap custom functions: { NAME: { render(args) } }
 */
export function evaluateFormula(src, getCellText, visiting = new Set(), formulaMap = {}) {
  let ast;
  try {
    ast = parse(src);
  } catch (e) {
    if (isError(e)) return e;
    throw e;
  }

  const cellValue = (sheet, col, row) => {
    const text = getCellText(col, row, sheet);
    if (text === undefined) return err('#REF!');
    if (typeof text === 'string' && text.startsWith('=') && text.length > 1) {
      const key = `${sheet ?? ''}!${col},${row}`;
      // a circular reference evaluates to 0, as Excel shows it
      if (visiting.has(key)) return 0;
      visiting.add(key);
      const nested = (nestedCol, nestedRow, nestedSheet) => getCellText(nestedCol, nestedRow, nestedSheet ?? sheet);
      const value = evaluateFormula(text.slice(1), nested, visiting, formulaMap);
      visiting.delete(key);
      return value;
    }
    return literalOf(text);
  };

  const evalNode = (node) => {
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'ref':
        return cellValue(node.sheet, node.col, node.row);
      case 'range': {
        // reversed ranges (B2:A1) are the same range
        const sc = Math.min(node.start.col, node.end.col);
        const ec = Math.max(node.start.col, node.end.col);
        const sr = Math.min(node.start.row, node.end.row);
        const er = Math.max(node.start.row, node.end.row);
        const values = [];
        for (let r = sr; r <= er; r += 1) {
          for (let c = sc; c <= ec; c += 1) values.push(cellValue(node.sheet, c, r));
        }
        return new Range(values);
      }
      case 'negate': {
        const n = toNumber(scalar(evalNode(node.operand)));
        return isError(n) ? n : -n;
      }
      case 'percent': {
        const n = toNumber(scalar(evalNode(node.operand)));
        return isError(n) ? n : n / 100;
      }
      case 'binary':
        return evalBinary(node.op, scalar(evalNode(node.left)), scalar(evalNode(node.right)));
      case 'call': {
        const fn = FUNCTIONS[node.name];
        const custom = formulaMap[node.name];
        if (!fn && !custom) return err('#NAME?');
        const args = node.args.map(evalNode);
        if (fn) return fn(args);
        return custom.render(flatten(args).map(toText));
      }
      default:
        return err('#VALUE!');
    }
  };

  return evalNode(ast);
}

function evalBinary(op, a, b) {
  if (op === '&') {
    if (isError(a)) return a;
    if (isError(b)) return b;
    return toText(a) + toText(b);
  }
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    if (isError(a)) return a;
    if (isError(b)) return b;
    const c = compare(a, b);
    switch (op) {
      case '=': return c === 0;
      case '<>': return c !== 0;
      case '<': return c < 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      default: return c >= 0;
    }
  }
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  if (isError(y)) return y;
  switch (op) {
    case '+': return x + y;
    case '-': return x - y;
    case '*': return x * y;
    case '/': return y === 0 ? err('#DIV/0!') : x / y;
    case '^': {
      const r = x ** y;
      return Number.isFinite(r) ? r : err('#NUM!');
    }
    default: return err('#VALUE!');
  }
}

/** Text shown for a formula result. */
export function formatFormulaValue(v) {
  if (v instanceof Range) return formatFormulaValue(v.values.length === 1 ? v.values[0] : err('#VALUE!'));
  if (isError(v)) return v.code;
  if (v == null) return '0';
  if (typeof v === 'number') return formatNumber(v);
  return toText(v);
}
