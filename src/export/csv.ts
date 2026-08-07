/**
 * CSV export.
 *
 * Spreadsheet applications evaluate a cell that begins with =, +, - or @ as a
 * formula, which turns an exported note into code execution on the machine of
 * whoever opens it. Every value is checked, not just the ones that look risky.
 */
import { getExportMarking } from './png'

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

function escapeCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value)
  const neutralised = FORMULA_PREFIXES.some((p) => raw.startsWith(p)) ? `'${raw}` : raw
  return `"${neutralised.replace(/"/g, '""')}"`
}

export interface CsvOptions {
  /**
   * Control marking, written as the first and the last line.
   *
   * A spreadsheet shows the first row and a printout shows the last, and a
   * file that carries a marking in only one of those places is a file someone
   * will hand on unmarked. The cost is that the marking rows are not data
   * rows, which is the same trade every marked document makes.
   */
  marking?: string | null
}

/**
 * Rows to CSV. `columns` fixes the column order and lets an empty set still
 * produce a header, which is the difference between "no rows" and "no file".
 */
export function toCsv(
  rows: Array<Record<string, unknown>>,
  columns?: string[],
  options: CsvOptions = {},
): string {
  const keys = columns ?? (rows.length ? Object.keys(rows[0]) : [])
  const header = keys.join(',')
  const body = rows.length
    ? rows.map((row) => keys.map((k) => escapeCell(row[k])).join(','))
    : []
  const marking = options.marking?.trim()
  if (!marking) return [header, ...body].join('\n')
  const band = `"${marking.replace(/"/g, '""')}"`
  return [band, header, ...body, band].join('\n')
}

/**
 * The marked spelling of toCsv, for anything a user downloads.
 *
 * Separate rather than making toCsv read the register on its own, because
 * toCsv is also how internal strings are built and a marking row inside one of
 * those would be a data bug. A download is the case that must not forget.
 */
export function markedCsv(
  rows: Array<Record<string, unknown>>,
  columns?: string[],
): string {
  return toCsv(rows, columns, { marking: getExportMarking() })
}

/**
 * Trigger a download without a server round trip.
 *
 * The marking is applied here as well as in markedCsv, because this is the
 * last point before a file leaves the machine and a caller that built its CSV
 * some other way must not be able to sidestep it. Already-marked text is left
 * alone rather than banded twice.
 */
export function downloadCsv(filename: string, csv: string): void {
  const marking = getExportMarking()?.trim()
  const band = marking ? `"${marking.replace(/"/g, '""')}"` : ''
  const text =
    band && !csv.startsWith(`${band}\n`) ? [band, csv, band].join('\n') : csv
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
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
