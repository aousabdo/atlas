import { describe, expect, it } from 'vitest'

import { toCsv } from '../csv'

describe('toCsv', () => {
  it('neutralises formula-injection prefixes', () => {
    for (const dangerous of ['=cmd|calc', '+1+1', '-1+1', '@SUM(A1)']) {
      const csv = toCsv([{ note: dangerous }])
      expect(csv.split('\n')[1], dangerous).toMatch(/^"'/)
    }
  })

  it('leaves an ordinary value alone apart from quoting', () => {
    expect(toCsv([{ a: 'plain' }]).split('\n')[1]).toBe('"plain"')
  })

  it('quotes embedded commas and doubles embedded quotes', () => {
    expect(toCsv([{ a: 'x,y' }])).toContain('"x,y"')
    expect(toCsv([{ a: 'he said "hi"' }])).toContain('""hi""')
  })

  it('writes a header row from the keys', () => {
    expect(toCsv([{ id: 'a', risk: 'high' }]).split('\n')[0]).toBe('id,risk')
  })

  it('returns just a header for an empty set, not an empty string', () => {
    expect(toCsv([], ['id'])).toBe('id')
  })

  it('honours an explicit column order', () => {
    const csv = toCsv([{ b: 2, a: 1 }], ['a', 'b'])
    expect(csv.split('\n')[0]).toBe('a,b')
    expect(csv.split('\n')[1]).toBe('"1","2"')
  })

  it('renders null and undefined as empty rather than the words', () => {
    const csv = toCsv([{ a: null, b: undefined }], ['a', 'b'])
    expect(csv.split('\n')[1]).toBe('"",""')
  })
})
