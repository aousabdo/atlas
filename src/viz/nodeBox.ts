import type { TreeNode } from '../types/tree'

/**
 * How big a node's box is, derived from its label without a DOM.
 *
 * This lives in viz/ rather than beside the component that draws it because
 * two things need the answer and they must not disagree. The renderer sizes
 * the rect it paints, and the layout decides how much of its ring to reserve.
 * When those were separate estimates the layout placed a 85px slot and the
 * renderer drew a 215px box into it, which is the whole reason nodes were
 * landing on top of one another. One function, one answer, or the bug comes
 * straight back the first time either copy is tuned.
 */

/**
 * Advance width per character, in ems, as an upper bound for the UI face.
 *
 * The alternative was to measure: render the text, read getComputedTextLength,
 * size the box, render again. That needs a laid-out DOM with the webfont
 * already resolved, so it costs a second pass, it jitters as Inter loads, it
 * reports 0 in jsdom so none of this could be tested, and the first paint of
 * every node is the wrong size. A table is deterministic, testable, and right
 * on the first frame. It is also what lets the layout stay a pure function of
 * the tree: doLayout can ask how wide a label draws without a browser.
 *
 * Every figure is rounded up rather than to the true advance. Over-estimating
 * costs a few pixels of empty box; under-estimating clips the label, which is
 * the failure this exists to prevent, so the error is spent on the safe side.
 */
const ADVANCE_SPACE = 0.32
const ADVANCE_NARROW = 0.4
const ADVANCE_LOWER = 0.6
const ADVANCE_DIGIT = 0.62
const ADVANCE_UPPER = 0.74
/**
 * Symbols, and any script this table does not model.
 *
 * Above the widest Latin letter on purpose. A label from somebody's own
 * workbook can carry an ampersand, a currency mark or a Cyrillic name, and the
 * only answer that is never wrong in the damaging direction is a generous one.
 */
const ADVANCE_UNKNOWN = 0.78
const ADVANCE_WIDE = 0.92
/** CJK, Kana, Hangul and emoji are drawn on a full-width body. */
const ADVANCE_FULL_WIDTH = 1.05

const WIDE = new Set([...'MWmw@%'])
const NARROW = new Set([...'iljItfr.,:;\'!|()[]{}'])
/** ASCII letters plus Latin-1 Supplement and Latin Extended-A/B. */
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/

/** Bold is drawn on the root and the level-1 branches, and bold is wider. */
const BOLD_STRETCH = 1.06

/** Clear space between the text and the border, horizontally and vertically. */
export const PAD_X = 7
export const PAD_Y = 5

/** Baseline-to-baseline distance as a multiple of the font size. */
export const LINE_HEIGHT = 1.25

function advanceEm(ch: string): number {
  if (ch === ' ') return ADVANCE_SPACE
  const cp = ch.codePointAt(0) ?? 0
  if (cp > 0x2e7f) return ADVANCE_FULL_WIDTH
  if (cp > 0x024f) return ADVANCE_UNKNOWN
  if (WIDE.has(ch)) return ADVANCE_WIDE
  if (NARROW.has(ch)) return ADVANCE_NARROW
  if (cp >= 0x30 && cp <= 0x39) return ADVANCE_DIGIT
  if (!LATIN_LETTER.test(ch)) return ADVANCE_UNKNOWN
  return ch === ch.toLowerCase() ? ADVANCE_LOWER : ADVANCE_UPPER
}

/** Width one line of label occupies at `fontSize`, in user units. */
export function lineWidth(text: string, fontSize: number, bold: boolean): number {
  let em = 0
  for (const ch of text) em += advanceEm(ch)
  return em * fontSize * (bold ? BOLD_STRETCH : 1)
}

export interface NodeGeometry {
  width: number
  height: number
  rx: number
  fontSize: number
  lineHeight: number
}

/**
 * Box and type sizes per depth, from cuas_tool_template_v6.html:3480-3482, and
 * then whatever the label actually needs on top.
 *
 * The per-depth sizes were constants while the label was data, so the map drew
 * a 25-character name in an 85px box and centred it, losing characters off both
 * ends. A reader cannot see that: "Partner Agency" reads as "artner Agenc" and
 * looks like a name. The two view controls made it worse rather than better,
 * because the label scale multiplied the type and the box scale multiplied the
 * box, so turning labels up was a way to clip them.
 *
 * So the depth sizes are a floor and the label sets the rest. The box scale
 * still does what it says, it raises the floor; the label scale can no longer
 * push text past the border, because the border moves with it. The cost is that
 * a long name draws a wide node, and wide nodes have to be placed further apart
 * than narrow ones. That cost is the layout's to pay, and src/viz/radial.ts
 * pays it by asking this function how much room to leave.
 */
export function geometryFor(
  node: TreeNode,
  level: number,
  textScale = 1,
  nodeScale = 1,
): NodeGeometry {
  const isRoot = level === 0
  const lines = node.label.split('\n')
  const fontSize = (isRoot ? 13 : level === 1 ? 11.5 : level === 2 ? 10.5 : 9.5) * textScale
  const lineHeight = fontSize * LINE_HEIGHT
  const bold = level <= 1

  const floorWidth = (isRoot ? 120 : level === 1 ? 105 : level === 2 ? 95 : 85) * nodeScale
  const floorHeight = (isRoot ? 52 : lines.length > 1 ? 42 : 32) * nodeScale

  let widest = 0
  for (const line of lines) {
    const w = lineWidth(line, fontSize, bold)
    if (w > widest) widest = w
  }

  const width = Math.max(floorWidth, widest + 2 * PAD_X)
  const height = Math.max(floorHeight, lines.length * lineHeight + 2 * PAD_Y)
  return { width, height, rx: isRoot ? height / 2 : 10 * nodeScale, fontSize, lineHeight }
}
