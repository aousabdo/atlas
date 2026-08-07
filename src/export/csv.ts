/**
 * CSV export.
 *
 * Spreadsheet applications evaluate a cell that begins with =, +, - or @ as a
 * formula, which turns an exported note into code execution on the machine of
 * whoever opens it. Every value is checked, not just the ones that look risky.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

function escapeCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  const neutralised = FORMULA_PREFIXES.some((p) => raw.startsWith(p)) ? `'${raw}` : raw
  return `"${neutralised.replace(/"/g, '""')}"`
}

/**
 * Rows to CSV. `columns` fixes the column order and lets an empty set still
 * produce a header, which is the difference between "no rows" and "no file".
 */
export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns?: string[],
): string {
  const keys = columns ?? (rows.length ? Object.keys(rows[0]) : [])
  const header = keys.join(',')
  if (!rows.length) return header
  const body = rows.map((row) => keys.map((k) => escapeCell(row[k])).join(','))
  return [header, ...body].join('\n')
}

/** Trigger a download without a server round trip. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
