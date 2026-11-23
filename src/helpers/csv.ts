/**
 * CSV, enough of RFC 4180 for a member list: quoted fields, doubled quotes,
 * commas and line breaks inside quotes, CRLF or LF.
 *
 * Written here rather than added as a dependency — the project takes none —
 * and pure, so tests import it directly.
 */

/** Parse CSV text into rows of fields. A leading byte-order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const source = String(text ?? '').replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < source.length; i++) {
    const char = source[i]

    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field === '') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += char
  }

  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  // Blank lines are not records.
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''))
}

/**
 * One field, quoted when it has to be — and defused when a spreadsheet would
 * run it.
 *
 * A member's name is whatever they typed at sign-up, and a name starting with
 * `=`, `+`, `-` or `@` is a formula to Excel and Sheets: `=HYPERLINK(...)` in
 * an export is how a reader gets code run on the admin's machine. A leading
 * apostrophe makes it text, which is the OWASP advice.
 */
export function csvField(value: unknown): string {
  // Postgres returns timestamps as Dates, whose String() is not a format anyone exports.
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Rows to CSV text, CRLF-delimited as RFC 4180 says. */
export function toCsv(rows: unknown[][]): string {
  return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}
