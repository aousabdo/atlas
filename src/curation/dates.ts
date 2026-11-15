/**
 * The review date, read and written one way in both engines.
 *
 * ASCII digits only: Python's \d also matches other scripts' digits, and
 * JavaScript's does not, so `[0-9]` is the one pattern the two read alike.
 */
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * A real calendar day written YYYY-MM-DD, year 1 or later.
 *
 * Mirrors _is_calendar_date in ingest/src/atlas_ingest/validate.py, which asks
 * datetime.date. JavaScript's calendar has a year 0 and rolls an impossible
 * day into the next month, so both are checked by hand: the year directly, and
 * the day by building it and seeing whether it comes back unchanged.
 * setUTCFullYear rather than Date.UTC, because Date.UTC reads years 0-99 as
 * 1900-1999.
 */
export function isCalendarDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/** The local calendar day of `date`, as YYYY-MM-DD. */
export function localDate(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`
}
