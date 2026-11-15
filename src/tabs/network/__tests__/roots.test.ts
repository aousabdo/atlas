import { describe, expect, it } from 'vitest'

import { NODE_STYLE } from '../NetworkLegend'
import { kindWord, rootOptionLabel } from '../roots'

describe('kindWord', () => {
  it('says the legend word, lower case, for one device', () => {
    expect(kindWord('switch')).toBe('switch')
    expect(kindWord('access_point')).toBe('access point')
    expect(kindWord('radio', 1)).toBe('radio link')
  })

  it('says switches, not switchs', () => {
    expect(kindWord('switch', 2)).toBe('switches')
    expect(kindWord('switch', 16)).toBe('switches')
  })

  it('pluralises every other legend word with a plain s', () => {
    expect(kindWord('gateway', 5)).toBe('gateways')
    expect(kindWord('access_point', 6)).toBe('access points')
    expect(kindWord('radio', 4)).toBe('radio links')
    expect(kindWord('satellite_terminal', 2)).toBe('satellite terminals')
    expect(kindWord('vlan', 3)).toBe('VLAN segments')
  })

  it('keeps an acronym upper case mid-sentence', () => {
    expect(kindWord('vlan')).toBe('VLAN segment')
    expect(rootOptionLabel({ choice: { source: 'type', deviceType: 'vlan' }, key: 'vlan', count: 2 }))
      .toBe('any VLAN segment (2)')
    // Every all-caps word in a legend label survives; every other word is lower case.
    for (const [type, { label }] of Object.entries(NODE_STYLE)) {
      const acronyms = label.split(' ').filter((part) => /^[A-Z]{2,}$/.test(part))
      for (const acronym of acronyms) expect(kindWord(type), type).toContain(acronym)
      expect(kindWord(type).replace(/\b[A-Z]{2,}\b/g, ''), type).toBe(
        kindWord(type).replace(/\b[A-Z]{2,}\b/g, '').toLowerCase(),
      )
    }
  })

  // A legend word added later that ends in a hiss needs its own entry, or it
  // goes back to reading "switchs".
  it('never adds a bare s to a word that ends in s, x, z, ch or sh', () => {
    for (const type of Object.keys(NODE_STYLE)) {
      expect(kindWord(type, 2), type).not.toMatch(/(s|x|z|ch|sh)s$/)
    }
  })
})
