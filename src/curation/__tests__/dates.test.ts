import { describe, expect, it } from 'vitest'

import { isCalendarDate, localDate } from '../dates'

describe('isCalendarDate', () => {
  it('accepts a real day written YYYY-MM-DD', () => {
    expect(isCalendarDate('2026-11-13')).toBe(true)
  })

  it('accepts a leap day in a leap year', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
  })

  it('refuses another way of writing the day', () => {
    expect(isCalendarDate('13/11/2026')).toBe(false)
  })

  it('refuses a day the month does not have', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false)
  })

  /** JavaScript's calendar has a year 0 and Python's does not, so neither may. */
  it('refuses year 0000', () => {
    expect(isCalendarDate('0000-01-01')).toBe(false)
  })

  /** Python's \d matches these, so the pattern names ASCII digits only. */
  it('refuses digits that are not ASCII', () => {
    expect(isCalendarDate('٢٠٢٦-١١-١٣')).toBe(false)
  })
})

describe('localDate', () => {
  it('writes the local calendar day as YYYY-MM-DD, padded', () => {
    expect(localDate(new Date(2026, 10, 3))).toBe('2026-11-03')
  })
})
