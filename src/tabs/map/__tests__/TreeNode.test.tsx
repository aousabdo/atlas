import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MapTab } from '../MapTab'
import {
  DEFAULT_NODE_SCALE, DEFAULT_TEXT_SCALE, NODE_MAX, NODE_MIN, TEXT_MAX, TEXT_MIN,
} from '../scales'
import { PAD_X, PAD_Y, TreeNode, geometryFor, lineWidth } from '../TreeNode'
import { renderWithProvider } from '../../../test/renderWithProvider'
import type { TreeNode as TreeNodeData } from '../../../types/tree'

afterEach(cleanup)

const node = (label: string): TreeNodeData => ({
  id: 'n', label, colorKey: 'inv', leaf: true,
})

/**
 * Labels invented for these tests, and deliberately awkward.
 *
 * The sample bundle can be tuned until it fits; a bundle an analyst loads from
 * their own workbook cannot, and that is the case this file exists for. So the
 * list runs from the widest glyphs the face has to the narrowest, carries the
 * one-line 25-character label the committed bundle actually ships, a label that
 * wraps to three lines, and a word with no space in it at all, which is the one
 * shape no wrapping rule can help.
 */
const AWKWARD = [
  'MMMMMMMMMMMMMM',
  'WWW WWW WWW',
  'illiiillliiill',
  'Enterprise Common Picture',
  'Perimeter\nWatch Grid\nRelay Node',
  'Unbreakablesinglewordname',
  'X',
  '',
  'Quadrant 12 / 34 (B)',
]

const LEVELS = [0, 1, 2, 3, 4]

/** The corners of what the two view controls can ask for, plus the default. */
const SCALES: Array<[number, number]> = [
  [DEFAULT_TEXT_SCALE, DEFAULT_NODE_SCALE],
  [TEXT_MIN, NODE_MIN],
  [TEXT_MIN, NODE_MAX],
  [TEXT_MAX, NODE_MIN],
  [TEXT_MAX, NODE_MAX],
]

describe('lineWidth', () => {
  it('grows with the font size', () => {
    expect(lineWidth('Relay', 20, false)).toBeCloseTo(2 * lineWidth('Relay', 10, false), 5)
  })

  it('charges a wide glyph more than a narrow one', () => {
    expect(lineWidth('MMMM', 10, false)).toBeGreaterThan(lineWidth('llll', 10, false))
  })

  it('charges bold more than regular, because the branches are bold', () => {
    expect(lineWidth('Relay', 10, true)).toBeGreaterThan(lineWidth('Relay', 10, false))
  })

  it('charges a full-width script by its own advance, not a Latin one', () => {
    // A locally loaded bundle can carry any script. Treating a CJK glyph as if
    // it were the width of an 'e' is how the box comes out half the size it
    // needs, which is the bug this whole file is about.
    expect(lineWidth('中国雷达', 10, false))
      .toBeGreaterThan(lineWidth('abcd', 10, false))
  })

  it('costs nothing for an empty line', () => {
    expect(lineWidth('', 12, false)).toBe(0)
  })

  /**
   * Anything the table does not have an entry for has to cost more than a
   * letter, not less. A symbol charged as if it were an 'e' is a box a little
   * too small, and a box a little too small takes a character off each end.
   */
  it.each(['&', '#', '©', 'Ж'])('charges %j more than a letter', (ch) => {
    expect(lineWidth(ch, 10, false)).toBeGreaterThan(lineWidth('e', 10, false))
  })

  it('charges an accented letter as the letter it is', () => {
    expect(lineWidth('é', 10, false)).toBe(lineWidth('e', 10, false))
    expect(lineWidth('É', 10, false)).toBe(lineWidth('E', 10, false))
  })
})

/**
 * The fit guarantee.
 *
 * A node whose box is narrower than its label centres the text on the box and
 * loses characters off BOTH ends, which is the worst way to fail: the reader
 * cannot tell it happened. "Partner Agency" read "artner Agenc" in the
 * committed baseline and looked like a label, not like damage.
 */
describe('geometryFor sizes the box to the label it was given', () => {
  // The box is the sum of the same floats the test adds up, so the two land a
  // few ulps apart. The claim is "the padding is there", not "the padding is
  // there to the last bit".
  const SLACK = 1e-9

  it.each(AWKWARD)('holds %j at every level and every scale', (label) => {
    for (const level of LEVELS) {
      for (const [textScale, nodeScale] of SCALES) {
        const g = geometryFor(node(label), level, textScale, nodeScale)
        const bold = level <= 1
        const lines = label.split('\n')
        const widest = Math.max(...lines.map((l) => lineWidth(l, g.fontSize, bold)))
        expect(g.width - widest).toBeGreaterThanOrEqual(2 * PAD_X - SLACK)
        expect(g.height - lines.length * g.lineHeight)
          .toBeGreaterThanOrEqual(2 * PAD_Y - SLACK)
      }
    }
  })

  it('keeps the ported box sizes as a floor for a label that fits', () => {
    const short = node('Ember')
    expect(geometryFor(short, 0).width).toBe(120)
    expect(geometryFor(short, 1).width).toBe(105)
    expect(geometryFor(short, 2).width).toBe(95)
    expect(geometryFor(short, 3).width).toBe(85)
    expect(geometryFor(short, 3).height).toBe(32)
  })

  it('still scales the floor with the box control', () => {
    const short = node('Ember')
    expect(geometryFor(short, 3, 1, 2).width).toBe(170)
  })

  /**
   * The label control used to be able to outrun the box: font size scaled to
   * 2.6 while the width stayed at whatever the depth said, so turning labels up
   * was a way to clip them. Now it grows the box only when it has to.
   */
  it('grows the box when the label control outruns it', () => {
    const long = node('Enterprise Common Picture')
    expect(geometryFor(long, 3, TEXT_MAX, 1).width)
      .toBeGreaterThan(geometryFor(long, 3, DEFAULT_TEXT_SCALE, 1).width)
  })

  it('gives a three-line label room for three lines', () => {
    const g = geometryFor(node('Perimeter\nWatch Grid\nRelay Node'), 3)
    expect(g.height).toBeGreaterThanOrEqual(3 * g.lineHeight)
  })
})

/**
 * What the component actually draws, not just what the geometry says.
 *
 * The rect and the text elements are read back off the rendered DOM, because a
 * correct geometry helper wired up wrongly clips exactly as badly as a wrong
 * one.
 */
describe('a rendered node holds its own label', () => {
  const noop = () => {}
  const draw = (label: string, level: number, textScale: number, nodeScale: number) =>
    render(
      <svg>
        <TreeNode
          position={{ x: 0, y: 0, level, node: node(label) }}
          at={{ x: 0, y: 0 }}
          expanded={false}
          selected={false}
          riskMode={false}
          textScale={textScale}
          nodeScale={nodeScale}
          onToggle={noop}
          onSelect={noop}
          onDragStart={noop}
          didDrag={() => false}
        />
      </svg>,
    )

  it.each(AWKWARD.filter(Boolean))('draws %j inside its rect', (label) => {
    draw(label, 3, DEFAULT_TEXT_SCALE, DEFAULT_NODE_SCALE)
    const drawn = screen.getByTestId('leaf-n')
    const rect = drawn.querySelector('rect')
    const width = Number(rect?.getAttribute('width'))
    const height = Number(rect?.getAttribute('height'))
    const texts = [...drawn.querySelectorAll('text')]

    for (const text of texts) {
      const size = Number(text.getAttribute('font-size'))
      expect(lineWidth(text.textContent ?? '', size, false)).toBeLessThanOrEqual(width)
    }
    // Centred: the block of lines sits symmetrically about the box centre, so
    // no line can hang off one end while the other end is empty.
    const ys = texts.map((t) => Number(t.getAttribute('y')))
    expect(ys.reduce((a, b) => a + b, 0) / ys.length).toBeCloseTo(0, 5)
    for (const y of ys) expect(Math.abs(y)).toBeLessThan(height / 2)
  })

  /**
   * The root is the node the committed baseline clipped most visibly: it drew
   * "Architecture" as "rchitectur". It is the one node drawn bold at 13pt, so
   * it is also the case a table of regular-weight advances gets wrong.
   */
  it('holds the bold two-line root label', () => {
    draw('Alpha Bravo\nArchitecture', 0, DEFAULT_TEXT_SCALE, DEFAULT_NODE_SCALE)
    const drawn = screen.getByTestId('leaf-n')
    const width = Number(drawn.querySelector('rect')?.getAttribute('width'))
    for (const text of drawn.querySelectorAll('text')) {
      const size = Number(text.getAttribute('font-size'))
      expect(lineWidth(text.textContent ?? '', size, true)).toBeLessThanOrEqual(width)
    }
    expect(width).toBeGreaterThan(120)
  })

  it('keeps the whole label in the accessible name, however it is wrapped', () => {
    draw('Perimeter\nWatch Grid\nRelay Node', 3, DEFAULT_TEXT_SCALE, DEFAULT_NODE_SCALE)
    expect(screen.getByRole('button', { name: 'Perimeter Watch Grid Relay Node' }))
      .toBeInTheDocument()
  })
})

/**
 * The whole map, at the view it opens at, which is where the defect was.
 *
 * The committed visual baseline showed two thirds of the leaves losing
 * characters off both ends, and unit tests over invented labels would not have
 * caught it, because the labels that broke are the ones the bundle ships. It
 * also reaches the branch nodes, whose labels never go through makeLabel at
 * all: "Other DHS Components" and "DoD Stakeholders" were clipped by the same
 * fixed width, and no change to a wrapping rule would have helped them.
 */
describe('every node the real map draws holds its own label', () => {
  it('draws no text wider than the box it sits in', async () => {
    const { user } = await renderWithProvider(<MapTab />)
    await user.click(await screen.findByRole('button', { name: 'Expand All' }))
    const canvas = await screen.findByRole('img', { name: /orientation map/i })

    const drawn = [...canvas.querySelectorAll('g[data-id]')]
    expect(drawn.length).toBeGreaterThan(32)

    const tight: string[] = []
    for (const group of drawn) {
      const width = Number(group.querySelector('rect')?.getAttribute('width'))
      for (const text of group.querySelectorAll('text')) {
        const label = text.textContent ?? ''
        // The toggle badge and the unconfirmed mark draw their own glyphs at
        // their own size inside the box; the label lines are the wide ones.
        if (label === '+' || label === '-' || label === '−' || label === '?') continue
        const size = Number(text.getAttribute('font-size'))
        const bold = Number(text.getAttribute('font-weight')) >= 700
        if (lineWidth(label, size, bold) > width) tight.push(`${label} in ${width}`)
      }
    }
    expect(tight).toEqual([])
  })
})
