import { describe, expect, it } from 'vitest'

import { LABEL_LINE_CHARS, makeId, makeLabel, stripParenthetical } from '../localFileParse'

/**
 * The wrapping rule, mirrored case for case from ingest/tests/test_identity.py.
 *
 * The provider contract compares the two implementations over the sample, and
 * the sample cannot reach this code at all: every system in it is in LABEL_MAP,
 * so every label comes back off the curated table and the wrap never runs. An
 * analyst's own workbook is the opposite, nothing but unmapped names, which
 * makes this the only place the two implementations of the fallback are held
 * against each other. Change one list, change the other.
 */
const WRAP_CASES: Array<[string, string]> = [
  ['Tiny', 'Tiny'],
  ['Short One', 'Short One'],
  ['Alpha Bravo Charlie Delta', 'Alpha Bravo\nCharlie Delta'],
  [
    'Alpha Bravo Charlie Delta Echo Foxtrot',
    'Alpha Bravo\nCharlie Delta\nEcho Foxtrot',
  ],
  ['Quadrant Overwatch Node', 'Quadrant\nOverwatch Node'],
  ['Perimeter Watch Grid Relay Node', 'Perimeter\nWatch Grid\nRelay Node'],
  ['Unbreakablesinglewordname', 'Unbreakablesinglewordname'],
  ['Ridge Watch (Legacy Variant)', 'Ridge Watch'],
]

describe('makeLabel', () => {
  it.each(WRAP_CASES)('wraps %j', (name, expected) => {
    expect(makeLabel(name)).toBe(expected)
  })

  /**
   * The rule stated as its guarantee.
   *
   * The old rule split the word list in half and said nothing about how long
   * the halves came out, so "Perimeter Watch Grid Relay Node" wrapped into two
   * fifteen-character lines and both of them overflowed the node. A budget the
   * output is measured against is the difference between a rule and a habit.
   */
  it.each(WRAP_CASES)('keeps every line of %j inside the budget', (name) => {
    for (const line of makeLabel(name).split('\n')) {
      expect(line.length <= LABEL_LINE_CHARS || !line.includes(' ')).toBe(true)
    }
  })

  it('uses the curated label when there is one', () => {
    expect(makeLabel('Trackwell Sensor AI')).toBe('Trackwell\nSensor AI')
  })

  /**
   * The curated table outranks the budget, deliberately.
   *
   * An entry in LABEL_MAP is a display decision somebody made on purpose, line
   * breaks included, and re-wrapping it here would overrule the one place an
   * analyst can say how a name should read. The node box is what guarantees the
   * text fits; this guarantees the text is the text that was chosen.
   */
  it('honours a curated label verbatim even when it is long', () => {
    expect(makeLabel('Enterprise Common Picture')).toBe('Enterprise Common Picture')
  })
})

// Mirrors PARENTHETICAL_CASES in ingest/tests/test_identity.py, case for case.
// The two implementations are held together by the provider contract, and this
// path is the one an analyst's own workbook exercises rather than the sample.
describe('a parenthetical leaves a space where it stood', () => {
  const CASES: Array<[string, string, string]> = [
    ["Ridge (Legacy Variant) Watch", "Ridge Watch", "ridge_watch"],
    ["(Prefix) Name", "Name", "name"],
    ["A (x) B (y) C", "A B C", "a_b_c"],
    ["KRL (Kestrel Relay Layer)", "KRL", "krl"],
    ["Plain Name", "Plain Name", "plain_name"],
  ]

  it.each(CASES)('%s', (name, stripped, ident) => {
    expect(stripParenthetical(name)).toBe(stripped)
    expect(makeId(name)).toBe(ident)
  })
})
