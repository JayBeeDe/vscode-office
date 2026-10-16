/** Excel / WPS clipboard TSV: tab-separated, quoted fields may contain newlines. */

function needsTsvQuoting(text) {
  return /[\t\r\n"]/.test(text);
}

function escapeTsvField(value) {
  const text = value == null ? '' : String(value);
  if (!needsTsvQuoting(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function formatTsvRows(rows) {
  const lines = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const cells = [];
    for (let j = 0; j < row.length; j += 1) {
      cells.push(escapeTsvField(row[j]));
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\n');
}

export function parseTsvRows(text) {
  if (!text) return [];

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    // only a quote at the start of a field opens a quoted field: 5" screen stays as typed
    if (ch === '"' && field === '' && (i === 0 || text[i - 1] === '\t' || text[i - 1] === '\n' || text[i - 1] === '\r')) {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (ch === '\t') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '\r') {
      i += 1;
      if (text[i] === '\n') i += 1;
      row.push(field);
      if (row.length > 1 || row[0] !== '' || rows.length > 0) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (inQuotes) {
    row.push(field);
    rows.push(row);
  } else if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '' && text.endsWith('\n')) {
      rows.pop();
    }
  }

  return rows;
}
