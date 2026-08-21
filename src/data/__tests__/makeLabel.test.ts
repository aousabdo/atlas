import { describe, expect, it } from 'vitest'

import {
  ID_MAX_CHARS, LABEL_LINE_CHARS, makeId, makeLabel, stripParenthetical,
} from '../localFileParse'

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

/**
 * The slug fallback, and why it fingerprints.
 *
 * Mirrored case for case, expected id for expected id, from SLUG_CASES in
 * ingest/tests/test_identity.py. The ids are written out as literals on both
 * sides on purpose: the fingerprint is the one place the two implementations
 * do arithmetic rather than string work, and a JavaScript Math.imul and a
 * Python int wrapping at 32 bits agreeing is a claim that has to be checked
 * rather than assumed. Change one list, change the other.
 *
 * Names below are invented for this test.
 */
const SLUG_CASES: Array<[string, string]> = [
  // Short enough to fit: no fingerprint, exactly the old answer.
  ['Some Brand New System', 'some_brand_new_system'],
  // Exactly at the budget: still no fingerprint.
  ['Harbour Point Relay Node Alpha', 'harbour_point_relay_node_alpha'],
  // One character over: the fingerprint starts here.
  ['Harbour Point Relay Node Bravos', 'harbour_point_relay_n_37a500b0'],
  // The prefix would end on an underscore, so it is trimmed and the id comes
  // out one character short of the budget rather than carrying a double.
  ['Sentinel Watch Relay North Field Array', 'sentinel_watch_relay_705cddce'],
  // The pair that used to collide.
  [
    'Coastal Perimeter Surveillance and Tracking Alpha',
    'coastal_perimeter_sur_fa065cd1',
  ],
  [
    'Coastal Perimeter Surveillance and Tracking Bravo',
    'coastal_perimeter_sur_eef71871',
  ],
  ['A'.repeat(60), 'aaaaaaaaaaaaaaaaaaaaa_92b9e111'],
]

describe('makeId falls back to a slug that cannot collide by truncation', () => {
  it.each(SLUG_CASES)('%j', (name, expected) => {
    expect(makeId(name)).toBe(expected)
  })

  it.each(SLUG_CASES)('keeps %j inside the id budget', (name) => {
    expect(makeId(name).length).toBeLessThanOrEqual(ID_MAX_CHARS)
  })

  /**
   * The collision this rule exists to prevent.
   *
   * makeId used to end in .slice(0, 30). These two names slug identically for
   * 30 characters, so both came out "coastal_perimeter_surveillance" and
   * nothing anywhere gated ids for uniqueness: the two rows became one id and
   * whichever was read second replaced the first in every map keyed by id. A
   * system leaving the matrix with no message is the failure this pins shut.
   */
  it('separates two names that agree in their first 30 slug characters', () => {
    const alpha = makeId('Coastal Perimeter Surveillance and Tracking Alpha')
    const bravo = makeId('Coastal Perimeter Surveillance and Tracking Bravo')
    expect(alpha).not.toBe(bravo)
    expect(alpha.startsWith('coastal_perimeter_sur')).toBe(true)
    expect(bravo.startsWith('coastal_perimeter_sur')).toBe(true)
  })

  /**
   * The fingerprint covers the WHOLE slug, not the part that survives. One
   * taken over the truncated prefix would have reproduced the defect with
   * extra steps.
   */
  it('separates names that differ only in their last character', () => {
    expect(makeId('Regional Airspace Coordination Centre East Wing A')).not.toBe(
      makeId('Regional Airspace Coordination Centre East Wing B'),
    )
  })

  /**
   * What is allowed to merge, stated so the fix cannot creep past it. Folding
   * punctuation and stripping a parenthetical are deliberate: two names that
   * normalise to the same slug are the same name as far as this tool is
   * concerned. Only truncation collisions were the bug.
   */
  it('still gives one id to two spellings of the same name', () => {
    expect(makeId('Ridge Watch (Legacy Variant)')).toBe(makeId('Ridge  Watch'))
  })
})
